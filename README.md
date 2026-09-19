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
| `packages/amc-steps` | Types and traversal for the step files. |
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

## Where this is going

The sequence and the evaluator are done and proven. The open work is the
integration:

- `vehicle_components` — AMC's model of the hardware the operator declares
  (props, ESC, battery monitor, FC MCU series) — drives 75 of the 108
  expressions, and ArduConfigurator has no equivalent concept today. That data
  model, and the UI for filling it, is the real remaining work.
- Mapping AMC steps onto ArduConfigurator's existing guided-mode shape
  (`setup-flow-helpers`, `setup-exercise-helpers`, `SetupWizard*`), which is
  already criteria-and-actions per section.
- Reading and writing parameters over the existing `@arduconfig/protocol-mavlink`
  link.

## Licensing

GPL-3.0, matching both upstreams. `vendor/` and `steps/` are AMC's work
(© Amilcar do Carmo Lucas and contributors); `packages/` is a derivative of it.
