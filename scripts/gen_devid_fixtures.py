"""
Run AMC's own device_rows() over a spread of parameter sets and record what it
returns, so the TypeScript port can be checked against CPython rather than
against anyone's reading of it. Same approach as gen_expr_fixtures.py.
"""
import json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "vendor" / "MethodicConfigurator"))
from ardupilot_methodic_configurator.data_model_fc_diagnostics import device_rows  # noqa: E402

tables = json.loads((ROOT / "steps" / "devid.json").read_text())

def devid(bus_type, bus, address, devtype):
    return bus_type | (bus << 3) | (address << 8) | (devtype << 16)

cases = []

# Every driver of every category, on a spread of bus types, buses and addresses.
prefix = {"compass": "COMPASS_DEV_ID", "imu": "INS_ACC_ID", "baro": "BARO1_DEVID", "airspeed": "ARSPD_DEVID"}
for category, name in prefix.items():
    for i, entry in enumerate(tables["device_types"][category]):
        bus_type = (1, 2, 4, 5)[i % 4]
        cases.append({f"{name}": float(devid(bus_type, i % 4, (i * 13) % 256, entry["value"]))})

# A realistic whole vehicle: three compasses with priorities, two IMUs (acc and
# gyro, numbered instances), two baros, a DroneCAN compass, and noise around it.
cases.append({
    "COMPASS_DEV_ID": float(devid(1, 0, 0x1e, 5)),
    "COMPASS_DEV_ID2": float(devid(3, 0, 125, 1)),
    "COMPASS_DEV_ID3": float(devid(2, 1, 0x0c, 9)),
    "COMPASS_PRIO1_ID": float(devid(3, 0, 125, 1)),
    "COMPASS_PRIO2_ID": float(devid(1, 0, 0x1e, 5)),
    "COMPASS_PRIO3_ID": 0.0,
    "INS_ACC_ID": float(devid(2, 1, 0, 0x2b)),
    "INS_ACC2_ID": float(devid(2, 2, 0, 0x2c)),
    "INS_GYR_ID": float(devid(2, 1, 0, 0x2b)),
    "INS_GYR2_ID": float(devid(2, 2, 0, 0x2c)),
    "BARO1_DEVID": float(devid(1, 0, 0x76, 0x0a)),
    "BARO2_DEVID": float(devid(2, 3, 0, 0x0b)),
    "ARSPD_DEVID": 0.0,
    "INS_ACC_BODYFIX": 2.0,
    "COMPASS_USE": 1.0,
    "SERIAL1_PROTOCOL": 2.0,
})

# Edge cases: the boundaries the Python handles by raising or skipping.
cases.append({"COMPASS_DEV_ID": 0.0, "BARO1_DEVID": -5.0, "INS_ACC_ID": float(0x01000000)})
cases.append({"COMPASS_DEV_ID": 97539.7, "INS_GYR_ID": 132618.2})          # int() truncates
cases.append({"COMPASS_DEV_ID": float(devid(1, 0, 30, 5)), "COMPASS_PRIO1_ID": float(devid(1, 0, 30, 5)) + 0.5})  # non-integer priority
cases.append({"COMPASS_DEV_ID": float(devid(1, 0, 30, 5)), "COMPASS_PRIO2_ID": float(devid(1, 0, 30, 5)), "COMPASS_PRIO1_ID": float(devid(1, 0, 30, 5))})  # lowest wins
cases.append({"COMPASS_DEV_ID": float(devid(1, 0, 30, 250))})              # unknown driver
cases.append({"COMPASS_DEV_ID": float(devid(7, 0, 30, 5))})                # unknown bus type
cases.append({"INS_ACC3_ID": float(devid(2, 0, 0, 0x2b)), "INS_ACC_ID": float(devid(2, 0, 0, 0x2b))})

out = []
for params in cases:
    rows = device_rows(dict(params))
    out.append({"params": params, "rows": [list(r) for r in rows]})

dest = ROOT / "tests" / "fixtures" / "device-rows.json"
dest.write_text(json.dumps(out, indent=1) + "\n")
print(f"{len(out)} parameter sets, {sum(len(c['rows']) for c in out)} rows from AMC's device_rows")
