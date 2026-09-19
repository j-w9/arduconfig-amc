"""
Generate the golden corpus the TypeScript expression evaluator is tested against.

Every `if` guard and `New Value` expression in AMC's configuration-step files is
evaluated here, in Python, against each vendored vehicle template -- so the port
in packages/amc-expr is checked against what upstream actually computes rather
than against our reading of it.

simpleeval is not required: the grammar in these files (arithmetic, comparison,
membership, ternary, indexing, whitelisted calls) evaluates identically under a
namespace-restricted builtin eval, which keeps this script dependency-free.

Re-run after scripts/sync-from-vendor.mjs. Output: tests/fixtures/expressions.json
"""

import json
import re
from math import log
from pathlib import Path

from packaging.version import Version

ROOT = Path(__file__).resolve().parent.parent
STEPS = ROOT / "steps"
TEMPLATES = ROOT / "vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates"
OUT = ROOT / "tests/fixtures/expressions.json"

SAFE_FUNCTIONS = {"max": max, "min": min, "round": round, "abs": abs, "len": len, "log": log, "Version": Version, "int": int}


def collect_expressions() -> list[dict]:
    """Every distinct expression, tagged with the step and field it came from."""
    seen: dict[str, dict] = {}
    for path in sorted(STEPS.glob("configuration_steps_*.json")):
        if "schema" in path.name:
            continue
        vehicle = path.stem.replace("configuration_steps_", "")
        doc = json.loads(path.read_text())

        def walk(node, trail):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key in ("if", "New Value") and isinstance(value, str):
                        seen.setdefault(value, {"expr": value, "kind": key, "vehicle": vehicle, "path": "/".join(trail)})
                    walk(value, [*trail, str(key)])
            elif isinstance(node, list):
                for i, value in enumerate(node):
                    walk(value, [*trail, str(i)])

        walk(doc, [])
    return sorted(seen.values(), key=lambda e: e["expr"])


def read_params(path: Path) -> dict[str, float]:
    """Parse an ArduPilot .param file into the fc_parameters mapping."""
    params: dict[str, float] = {}
    for line in path.read_text(errors="replace").splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        parts = re.split(r"[,\s]+", line, maxsplit=1)
        if len(parts) != 2:
            continue
        try:
            params[parts[0].strip()] = float(parts[1].strip())
        except ValueError:
            continue
    return params


def collect_contexts() -> list[dict]:
    """One evaluation context per vendored vehicle template."""
    contexts = []
    for components in sorted(TEMPLATES.glob("*/*/vehicle_components.json")):
        template = components.parent
        defaults = template / "00_default.param"
        contexts.append(
            {
                "name": f"{template.parent.name}/{template.name}",
                "vehicle_components": json.loads(components.read_text()).get("Components", {}),
                "fc_parameters": read_params(defaults) if defaults.exists() else {},
            }
        )
    return contexts


def main() -> None:
    expressions = collect_expressions()
    contexts = collect_contexts()
    cases = []
    for ctx in contexts:
        names = {"vehicle_components": ctx["vehicle_components"], "fc_parameters": ctx["fc_parameters"]}
        for entry in expressions:
            case = {"expr": entry["expr"], "kind": entry["kind"], "context": ctx["name"]}
            try:
                value = eval(entry["expr"], {"__builtins__": {}}, {**SAFE_FUNCTIONS, **names})  # noqa: S307
                # Version objects are compared, never returned, but guard anyway.
                case["value"] = str(value) if isinstance(value, Version) else value
                # JSON cannot tell 1 from 1.0, and the difference reaches the
                # flight controller, so name the Python type alongside.
                case["type"] = type(value).__name__
            except Exception as exc:  # noqa: BLE001 - the error *is* the expected outcome
                case["error"] = type(exc).__name__
            cases.append(case)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "generatedBy": "scripts/gen_expr_fixtures.py",
                "provenance": json.loads((STEPS / "PROVENANCE.json").read_text())["commit"],
                "contexts": [c["name"] for c in contexts],
                "expressions": len(expressions),
                "cases": cases,
            },
            indent=1,
        )
        + "\n"
    )
    ok = sum(1 for c in cases if "value" in c)
    print(f"{len(expressions)} expressions x {len(contexts)} templates = {len(cases)} cases ({ok} evaluated, {len(cases) - ok} raised)")


if __name__ == "__main__":
    main()
