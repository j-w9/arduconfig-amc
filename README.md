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
| `apps/arduconfigurator` | ArduConfigurator, pinned. The frontend being experimented on. |
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

The one forced parameter that differs is an upstream data inconsistency rather
than a computation: the step file hard-codes `LOG_BITMASK` as 407517 and
`Holybro_X500`'s committed file says 407519. It is pinned in the test, so a
*second* one would fail the suite.

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
- **Three named values do not resolve** against ArduConfigurator's parameter
  metadata. Several steps set a parameter from a component's own words --
  `FRAME_CLASS` from `'Quad'` -- which needs ArduPilot's documented value lists.
  `'FETtecOneWire'` and `'INA2XX'` are not in the metadata's options, and
  `MOT_PWM_TYPE` is missing from `arduplane.json` altogether. Pinned in the test
  so the set stays visible and cannot quietly grow.

A directive that cannot be evaluated is collected and reported, never dropped:
a half-applied step is worse than a refused one, so the caller decides whether
an incomplete step may still be written.

## Where this is going

The sequence and the evaluator are done and proven. The open work is the
integration:

- **The component editor UI.** `requiredComponents()` derives the fields the
  operator must supply by walking the parsed expressions, so the form's contents
  come from the step files rather than from a guess at them — 9 components and
  about 20 fields today. Nothing renders it yet.
- **Mapping AMC steps onto ArduConfigurator's guided-mode shape**
  (`setup-flow-helpers`, `setup-exercise-helpers`, `SetupWizard*`), which is
  already criteria-and-actions per section.
- **Reading and writing parameters** over the existing
  `@arduconfig/protocol-mavlink` link. Nothing here has touched a flight
  controller yet.
- **Filling the three metadata gaps** above, in ArduConfigurator's generated
  parameter documentation.

## Licensing

GPL-3.0, matching both upstreams. `vendor/` and `steps/` are AMC's work
(© Amilcar do Carmo Lucas and contributors); `packages/` is a derivative of it.
