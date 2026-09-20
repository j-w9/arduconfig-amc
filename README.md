# arduconfig-amc

A development fork for experimenting with replacing ArduConfigurator's guided
mode with ArduPilot Methodic Configurator's configuration sequence, driven from
ArduConfigurator's web frontend.

**This is an experiment.** Nothing here is wired into a flight controller yet.

## The idea

AMC's guided sequence is a good sequence, and it is almost entirely *data*: four
JSON files of ordered steps, each naming the parameters to set, a reason for
each, and a guard expression deciding whether it applies. What is Python is the
part that *interprets* that data — a ~90-line safe expression evaluator over
`vehicle_components` and `fc_parameters`.

So the fork keeps AMC's sequence and reimplements the interpreter in
TypeScript, rather than running a Python service beside the browser. The web
frontend keeps the serial link it already has.

## Layout

| Path | What it is |
| --- | --- |
| `vendor/MethodicConfigurator` | Upstream AMC, pinned. Read-only; the source of truth for the sequence. |
| `apps/arduconfigurator` | ArduConfigurator, on its `amc-guided` branch. The frontend being experimented on. |
| `steps/` | The step files copied out of the vendor pin by `npm run sync`. |
| `packages/amc-expr` | TypeScript port of AMC's safe expression evaluator. |
| `packages/amc-steps` | Types, traversal, and the runner that turns a step into parameter changes. |
| `tests/` | Parity and semantics tests. |

Both submodules are pinned; `steps/PROVENANCE.json` records the AMC commit the
step files came from.

```sh
git submodule update --init --depth 50
npm install
npm test
```

## How the port is kept honest

`packages/amc-expr` is a reimplementation of someone else's evaluator, which is
the kind of thing that looks finished long before it is correct. So it is not
checked against our reading of upstream — it is checked against upstream's
output.

`scripts/gen_expr_fixtures.py` extracts every `if` guard and `New Value`
expression from the step files (108 of them), evaluates each in CPython against
every vendored vehicle template (25 of them), and records the result *and its
Python type*. `tests/expression-parity.test.mjs` replays all 2,700 cases
through the TypeScript port and requires an exact match.

That corpus is what found the interesting bugs. Each of these was a silent
wrong answer, not a crash:

- **`round()` is half-to-even in Python**, and applied to the double's exact
  value. `round(2.5)` is 2, and `round(5.55, 1)` is 5.5 — because 5.55 is really
  5.5499…, so the obvious `value * 10 ** digits` invents a tie that is not
  there. The port reconstructs the exact binary value as a rational and rounds
  with integer arithmetic.
- **int and float are different types**, and the difference reaches the flight
  controller. `round(27000, -2)` is an int; `4 / 2` is a float. `JSON.parse`
  collapses `4.0` to `4`, so the step and component files are loaded through a
  reviver that classifies numbers by their literal source text.
- **Every ArduPilot parameter is a float on the wire**, which is why the step
  files write `1 << int(fc_parameters['EK3_PRIMARY'])` rather than shifting
  directly.
- **`0 ** -0.838` raises `ZeroDivisionError`** in Python where JavaScript
  returns `Infinity` — reachable from any template with a propeller diameter of
  0.
- Floor division and modulo take the divisor's sign; `and`/`or` return an
  operand rather than a boolean; shifts must stay exact past 32 bits.

`tests/python-semantics.test.mjs` pins each rule individually, so a regression
names the rule rather than the vehicle that exposed it.

## End to end, against the templates

AMC ships the `.param` files it produced for each of its 29 vehicle templates,
which makes them an oracle for the whole stack rather than just the evaluator.
The invariant is asymmetric, and the asymmetry is the point:

- **`forced_parameters` are non-negotiable**, so the runner must reproduce them.
  It does: 1,257 of 1,258 across every template and every vehicle type.
- **`derived_parameters` are starting points** an operator tunes away from --
  `PSC_ACCZ_*` and `INS_HNTCH_FREQ` come out of flight logs -- so they are
  computed but deliberately not asserted.

Every forced parameter is reproduced, with no exceptions — but getting there
meant reading a marker rather than assuming a mistake. `Holybro_X500` commits
`LOG_BITMASK` as 407519 where the step file forces 407517, which looks like an
inconsistency in the data until you notice the comment on that line begins with
`@manual_override`.

That is a documented AMC mechanism, not a typo. On a parameter the sequence
forces or derives, it records that the operator deliberately chose a different
value, and AMC lets the file's value win over the computed one. Here the
difference is a single bit: whoever set up that aircraft kept **Medium
Attitude** logging on during PID notch tuning. The marker is read now
(`parseParamFile`), so a template that overrides something is understood rather
than listed as an exception — and the next one is handled without editing a
test.

### What running the real sequence surfaced

Evaluating every step against every template turned up three things, none of
them port bugs:

- **Blank templates fail, and should.** The `empty_*` templates have a propeller
  diameter of 0, so the filter-frequency steps raise rather than inventing a
  number. That failure is the UI's cue to go ask the operator.
- **Some steps read parameters the vehicle does not have.** The Plane, Rover and
  Heli sequences read `MOT_THST_HOVER` and `MOT_BAT_VOLT_MAX` -- Copter
  parameters -- without guarding with `in fc_parameters` first. Upstream
  tolerates this by logging and carrying on, and so do we.
- **One named value does not resolve**, and should not. Several steps set a
  parameter from a component's own words — `FRAME_CLASS` from `'Quad'` — which
  needs ArduPilot's documented value lists. `FETtecOneWire` is a *serial* ESC
  protocol, so `MOT_PWM_TYPE`, which enumerates PWM output types, has no number
  for it; AMC hits the same wall and skips the parameter. Two others used to sit
  here and were ours to fix: `INA2XX` is documented as
  `INA2XX (INA226 INA228 …)`, which exact matching missed, and Plane carries the
  quadplane's `Q_M_PWM_TYPE` rather than `MOT_PWM_TYPE`.

A directive that cannot be evaluated is collected and reported, never dropped:
a half-applied step is worse than a refused one, so the caller decides whether
an incomplete step may still be written.

## In the app

`apps/arduconfigurator` is on an `amc-guided` branch carrying an **AMC Guided**
tab, which sits beside the native Guided Setup rather than replacing it so the
two can be compared on the same vehicle. It is Expert-only and read-only: there
is deliberately no apply affordance yet.

The packages and step data are resolved into that branch by alias (Vite,
Vitest and TypeScript each point two levels up at this repo), so the branch
carries no copy of them:

```sh
git submodule update --init --depth 50
npm install                                   # this repo
cd apps/arduconfigurator && npm install        # the app
npm run dev:web                                # then: Expert Mode -> AMC Guided
```

The tab shows the 63-step Copter sequence, a form for declaring the vehicle, and
per-step the parameters each step would set with the reason from the step file.
Declaring a single field — a 10-inch propeller — takes it from 52 computed
parameters to 60, and from 88 blocked directives to 80.

Two things the integration is careful about:

- **The form is derived, not written.** The fields come from walking the parsed
  expressions, so a step added upstream that reads a new component field makes
  the field appear.
- **Declared values are assembled as JSON text**, not through a JavaScript
  object, because `4` and `4.0` compute differently and `JSON.stringify` would
  erase the distinction.

The four step files are ~470 KB together, so each is dynamic-imported into its
own ~15 KB gzipped chunk rather than riding in the main bundle.

## Where this is going

The sequence and the evaluator are done and proven. The open work is the
integration:

- **Reading a real vehicle.** The tab compares against live parameters when one
  is connected, but this has only been exercised against the demo transport.
- **Better blocked-step copy.** A step that needs an undeclared component says
  `KeyError: 'ESC'`, which is honest but is the evaluator's voice, not the
  operator's. The failure knows its expression, so it could name the field to
  fill in instead.
- **Writing.** Nothing here has touched a flight controller. An apply path would
  go through the existing parameter-draft machinery, so changes stay reviewable
  and revertible rather than being written on sight.
- **Mapping AMC steps onto ArduConfigurator's guided-mode shape**
  (`setup-flow-helpers`, `setup-exercise-helpers`, `SetupWizard*`), which is
  already criteria-and-actions per section.
- **Filling the three metadata gaps** above, in ArduConfigurator's generated
  parameter documentation.

## Licensing

GPL-3.0, matching both upstreams. `vendor/` and `steps/` are AMC's work
(© Amilcar do Carmo Lucas and contributors); `packages/` is a derivative of it.
