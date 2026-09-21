#!/usr/bin/env python3
"""
Extract AMC's connection lookup tables into JSON.

`data_model_vehicle_components_validation.py` holds the tables that say what a
flight controller's own parameters imply about its hardware: which component a
SERIAL protocol belongs to, what BATT_MONITOR's values connect over, what
GPS_TYPE means, which RC protocol a bitmask bit is. They are the data behind
"derive the declaration from the vehicle" and there are several hundred
entries -- transcribing them by hand would be a slow way to introduce a typo
nobody would ever notice.

Executed rather than parsed: the tables are built from each other (RC_PROTOCOLS_DICT
uses RC_PORTS + SERIAL_PORTS, ESC_CONNECTION_DICT nests dicts keyed by tuples),
so evaluating the module's literals is the only way to get their real contents.
The module is read from the pinned vendor checkout, its imports of the wider
application stubbed out -- this file has no runtime dependencies of its own,
only type imports.
"""

import ast
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor/MethodicConfigurator/ardupilot_methodic_configurator"
# In dependency order: the validation tables reference the battery module's
# constants at module level.
SOURCES = [
    VENDOR / "battery_cell_voltages.py",
    VENDOR / "data_model_vehicle_components_validation.py",
    # Parameter renames between firmware versions. Independent of the tables
    # above, but the same extraction problem: a few hundred renames where a
    # typo would silently drop an operator's value.
    VENDOR / "data_model_parameter_upgrade.py",
]
DEST = ROOT / "steps/connection-tables.json"

# Migrating a directory an older AMC wrote. Kept in its own file because it
# answers a different question from the tables above -- not "what does this
# parameter imply about the hardware" but "where did this parameter used to
# live" -- and because it is the one table whose absence is silent: a
# pre-v1 directory reads *almost* correctly without it.
MIGRATION_SOURCE = VENDOR / "backend_filesystem_migration.py"
MIGRATION_DEST = ROOT / "steps/migration.json"
MIGRATION_WANTED = [
    "VEHICLE_COMPONENTS_FORMAT_VERSION",
    "_PARAM_MOVES_V0_TO_V1",
    "_NEW_FILES_V0_TO_V1",
    "_FILES_TO_DELETE_V0_TO_V1",
]

WANTED = [
    "SERIAL_PORTS",
    "CAN_PORTS",
    "I2C_PORTS",
    "ANALOG_PORTS",
    "OTHER_PORTS",
    "RC_PORTS",
    "PWM_OUT_PORTS",
    "SERVO_FUNCTION_ESC_CONTROL",
    "ESC_TELEMETRY_ONLY_PROTOCOLS",
    "SERIAL_PROTOCOLS_DICT",
    "BATT_MONITOR_CONNECTION",
    "GNSS_RECEIVER_CONNECTION",
    "RC_PROTOCOLS_DICT",
    "ESC_CONNECTION_DICT",
    "FRAME_CLASS_DICT",
    "BATTERY_CELL_VOLTAGE_TYPES",
    "BATTERY_DEFAULT_CHEMISTRY",
    "_recommended_battery_cell_voltages",
    "PARAM_UPGRADE_DICT_46",
    "PARAM_UPGRADE_DICT_47",
]


def load_module_literals(paths: list[Path]) -> dict:
    """Execute only the modules' top-level assignments, with imports stubbed."""
    namespace: dict = {"__builtins__": __builtins__}
    # The annotations reference types from the stripped imports; a permissive
    # stub keeps `x: SomeType = {...}` evaluating. `nan` comes from math, which
    # the battery table uses for "no recommendation".
    stub = types.SimpleNamespace()
    for name in ("Any", "EscToFcTelemetryDict", "ComponentPath", "ComponentData"):
        namespace[name] = stub
    namespace["nan"] = float("nan")
    for path in paths:
        _exec_literals(path, namespace)
    return namespace


def _exec_literals(path: Path, namespace: dict) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    # Keep assignments and the odd helper they depend on; drop imports, classes
    # and functions, which is what needs the application around it.
    kept: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            kept.append(node)
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            # The annotation is dropped rather than kept: `dict[str, tuple[...] | str]`
            # is evaluated at runtime and fails without the real imports, and
            # only the VALUE is wanted here.
            # Every position copied from the node it replaces, not just
            # `lineno`. Setting the start alone leaves `end_lineno` pointing at
            # wherever the default put it, and Python 3.13+ validates that the
            # range is ordered -- it raises "AST node line range (13, 1) is not
            # valid" and compiles nothing. Python 3.9 does not check, so this
            # ran locally and failed in CI for seven hours.
            replacement = ast.Assign(targets=[node.target], value=node.value)
            kept.append(ast.copy_location(replacement, node))
    module = ast.fix_missing_locations(ast.Module(body=kept, type_ignores=[]))
    exec(compile(module, str(path), "exec"), namespace)  # noqa: S102


def jsonable(value):
    """Tuples, sets and frozensets become sorted-or-ordered lists."""
    if isinstance(value, dict):
        # A dict keyed by tuples (ESC_CONNECTION_DICT's ESC_to_FC) has no JSON
        # equivalent, so the key is joined -- it is only ever tested for
        # membership of the marker ("same_as_FC_to_ESC",).
        return {("|".join(k) if isinstance(k, tuple) else str(k)): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, (set, frozenset)):
        return sorted(jsonable(v) for v in value)
    if isinstance(value, float) and value != value:
        # NaN means "this chemistry has no recommendation for that voltage",
        # and JSON has no NaN; null carries the same meaning to the reader.
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def write_migration() -> int:
    """The v0 -> v1 tables, as their own file."""
    if not MIGRATION_SOURCE.exists():
        print(f"vendor source missing: {MIGRATION_SOURCE}", file=sys.stderr)
        return 1
    namespace = load_module_literals([MIGRATION_SOURCE])
    missing = [name for name in MIGRATION_WANTED if name not in namespace]
    if missing:
        print(f"migration tables missing from upstream: {', '.join(missing)}", file=sys.stderr)
        return 1
    tables = {name.strip("_"): jsonable(namespace[name]) for name in MIGRATION_WANTED}
    MIGRATION_DEST.write_text(json.dumps(tables, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {MIGRATION_DEST.relative_to(ROOT)}")
    return 0


def main() -> int:
    for source in SOURCES:
        if not source.exists():
            print(f"vendor source missing: {source}", file=sys.stderr)
            return 1
    namespace = load_module_literals(SOURCES)
    missing = [name for name in WANTED if name not in namespace]
    if missing:
        # Loud rather than silent: a table that quietly vanished upstream would
        # otherwise turn into an empty lookup and a vehicle that imports nothing.
        print(f"tables missing from upstream: {', '.join(missing)}", file=sys.stderr)
        return 1
    tables = {name: jsonable(namespace[name]) for name in WANTED}
    DEST.write_text(json.dumps(tables, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    counts = ", ".join(f"{name}={len(tables[name])}" for name in WANTED)
    print(f"wrote {DEST.relative_to(ROOT)} ({counts})")
    return write_migration()


if __name__ == "__main__":
    raise SystemExit(main())
