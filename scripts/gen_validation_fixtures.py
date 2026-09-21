"""Golden answers for declaration validation, taken from AMC rather than recalled.

The transcription in packages/amc-steps/src/validate-components.ts is checked
against this corpus. Transcribing a rule and then testing it against what I
believed the rule was proves only that I was consistent, which is the mistake
this whole audit habit exists to stop -- so the expectations come out of AMC's
own validator, run here.

Run with a Python 3.10+ interpreter that has AMC's dependencies:
    python3 scripts/gen_validation_fixtures.py > tests/fixtures/validation.json
"""

import json
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parent.parent / "vendor" / "MethodicConfigurator"
sys.path.insert(0, str(VENDOR))

from ardupilot_methodic_configurator.data_model_vehicle_components_validation import (  # noqa: E402
    ComponentDataModelValidation,
)


def model(components):
    """A validation model holding `components`, with nothing else configured."""
    m = ComponentDataModelValidation({"Components": components, "Format version": 1}, {}, None)
    chemistry = components.get("Battery", {}).get("Specifications", {}).get("Chemistry")
    if chemistry:
        m._battery_chemistry = chemistry
    return m


BATTERY = {"Battery": {"Specifications": {
    "Chemistry": "Lipo",
    "Volt per cell max": 4.2,
    "Volt per cell arm": 3.8,
    "Volt per cell low": 3.6,
    "Volt per cell crit": 3.3,
    "Volt per cell min": 3.2,
}}}

FRAME = {"Frame": {"Specifications": {"TOW min Kg": 0.6, "TOW max Kg": 1.2}}}

# (label, components, path, value)
CASES = [
    # Entry limits, both ends and both types.
    ("tow max in range", FRAME, ("Frame", "Specifications", "TOW max Kg"), "1.2"),
    ("tow max over 600", FRAME, ("Frame", "Specifications", "TOW max Kg"), "700"),
    ("tow max under 0.01", FRAME, ("Frame", "Specifications", "TOW max Kg"), "0.001"),
    ("tow max not a number", FRAME, ("Frame", "Specifications", "TOW max Kg"), "heavy"),
    ("cells in range", {}, ("Battery", "Specifications", "Number of cells"), "6"),
    ("cells zero", {}, ("Battery", "Specifications", "Number of cells"), "0"),
    ("cells over 50", {}, ("Battery", "Specifications", "Number of cells"), "51"),
    # int("4.5") raises in Python rather than truncating -- worth pinning.
    ("cells fractional", {}, ("Battery", "Specifications", "Number of cells"), "4.5"),
    ("capacity too small", {}, ("Battery", "Specifications", "Capacity mAh"), "99"),
    ("capacity fine", {}, ("Battery", "Specifications", "Capacity mAh"), "5200"),
    ("poles fine", {}, ("Motors", "Specifications", "Poles"), "14"),
    ("poles below 2", {}, ("Motors", "Specifications", "Poles"), "1"),
    ("poles over 100", {}, ("Motors", "Specifications", "Poles"), "102"),
    ("prop diameter fine", {}, ("Propellers", "Specifications", "Diameter_inches"), "10"),
    ("prop diameter tiny", {}, ("Propellers", "Specifications", "Diameter_inches"), "0.2"),

    # Takeoff weight against the other end.
    ("tow max below tow min", FRAME, ("Frame", "Specifications", "TOW max Kg"), "0.3"),
    ("tow min above tow max", FRAME, ("Frame", "Specifications", "TOW min Kg"), "3"),

    # Cell voltages: chemistry limits.
    ("cell max fine", BATTERY, ("Battery", "Specifications", "Volt per cell max"), "4.2"),
    ("cell max above lipo limit", BATTERY, ("Battery", "Specifications", "Volt per cell max"), "4.35"),
    ("cell min below lipo limit", BATTERY, ("Battery", "Specifications", "Volt per cell min"), "2.5"),
    ("cell voltage not a number", BATTERY, ("Battery", "Specifications", "Volt per cell low"), "flat"),

    # Cell voltages: the ordering, which is not one chain.
    ("cell max below arm", BATTERY, ("Battery", "Specifications", "Volt per cell max"), "3.5"),
    ("cell arm above max", BATTERY, ("Battery", "Specifications", "Volt per cell arm"), "4.3"),
    ("cell arm below low", BATTERY, ("Battery", "Specifications", "Volt per cell arm"), "3.4"),
    ("cell low above arm", BATTERY, ("Battery", "Specifications", "Volt per cell low"), "3.9"),
    ("cell low below crit", BATTERY, ("Battery", "Specifications", "Volt per cell low"), "3.1"),
    ("cell crit above low", BATTERY, ("Battery", "Specifications", "Volt per cell crit"), "3.7"),
    ("cell min above low", BATTERY, ("Battery", "Specifications", "Volt per cell min"), "3.7"),
    # crit and min have no ordering against EACH OTHER, only against low.
    ("cell min above crit is fine", BATTERY, ("Battery", "Specifications", "Volt per cell min"), "3.5"),
    ("cell crit below min is fine", BATTERY, ("Battery", "Specifications", "Volt per cell crit"), "3.1"),
]

out = {"entry": [], "chemistries": {}, "poles": [], "duplicates": []}

for label, components, path, value in CASES:
    m = model(components)
    message, corrected = m.validate_entry_limits(value, path)
    out["entry"].append({
        "label": label,
        "path": list(path),
        "value": value,
        "message": message,
        "suggestion": corrected,
    })

# Motor poles: the evenness check, which validate_entry_limits does not cover.
for value in ["14", "13", "2", "3", "many", "42"]:
    m = model({})
    errors = []
    m._validate_motor_poles(errors, ("Motors", "Specifications", "Poles"), value, "Motors>Specifications>Poles")
    out["poles"].append({"value": value, "errors": errors})

# The voltages re-seeded when the chemistry changes.
from ardupilot_methodic_configurator.battery_cell_voltages import BatteryCell  # noqa: E402

for chemistry in BatteryCell.chemistries():
    out["chemistries"][chemistry] = {
        "min": BatteryCell.limit_min_voltage(chemistry),
        "max": BatteryCell.limit_max_voltage(chemistry),
        "recommended": {
            vtype: BatteryCell.recommended_cell_voltage(chemistry, vtype)
            for vtype in ["Volt per cell max", "Volt per cell arm", "Volt per cell low",
                          "Volt per cell crit", "Volt per cell min"]
        },
    }

# Duplicate connections, through validate_all_data so the exceptions apply.
DUPLICATES = [
    ("two components on SERIAL1", [
        (("Telemetry", "FC Connection", "Type"), "SERIAL1"),
        (("GNSS Receiver", "FC Connection", "Type"), "SERIAL1"),
    ]),
    ("telemetry and rc receiver may share", [
        (("Telemetry", "FC Connection", "Type"), "SERIAL2"),
        (("RC Receiver", "FC Connection", "Type"), "SERIAL2"),
    ]),
    ("a CAN bus is shared by design", [
        (("GNSS Receiver", "FC Connection", "Type"), "CAN1"),
        (("Battery Monitor", "FC Connection", "Type"), "CAN1"),
    ]),
    ("None is not a port", [
        (("Telemetry", "FC Connection", "Type"), "None"),
        (("GNSS Receiver", "FC Connection", "Type"), "None"),
    ]),
    ("esc telemetry shares the esc's own serial line", [
        (("ESC", "FC->ESC Connection", "Type"), "SERIAL5"),
        (("ESC", "ESC->FC Telemetry", "Type"), "SERIAL5"),
    ]),
    ("an esc does not share with telemetry", [
        (("ESC", "FC->ESC Connection", "Type"), "SERIAL5"),
        (("Telemetry", "FC Connection", "Type"), "SERIAL5"),
    ]),
]

for label, entries in DUPLICATES:
    m = model({})
    valid, errors = m.validate_all_data(dict(entries))
    out["duplicates"].append({
        "label": label,
        "entries": [[list(p), v] for p, v in entries],
        "valid": valid,
        "errors": errors,
    })

print(json.dumps(out, indent=1, sort_keys=True))
