"""What AMC 5.0.0's tuning report says about every vehicle template it ships.

AMC writes tuning_report.csv from data_model_parameter_editor._update_tuning_report:
a row per watched gain, a column per tuning step, and since 5.0.0 the columns
depend on the vehicle. The method is run as-is on each template, with the
template's parameter files read the way LocalFilesystem reads them, so the
expected CSV is AMC's own output rather than a description of it. The
TypeScript port in packages/amc-steps/src/tuning-report.ts is checked against
it byte for byte.

Run from the repository root with a Python 3.10+ interpreter that has AMC's
dependencies installed:
    python scripts/gen_tuning_report_fixture.py > tests/fixtures/tuning-report.json
"""

import json
import sys
import tempfile
import types
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "vendor/MethodicConfigurator"))


class _Stub(types.ModuleType):
    """Stands in for tkinter, which the editor's module imports and this never uses."""

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        submodule = sys.modules.get(f"{self.__name__}.{name}")
        if submodule is not None:
            return submodule
        return type(name, (), {"__init__": lambda self, *a, **k: None})


try:
    import tkinter  # noqa: F401
except ImportError:
    for _name in ("tkinter", "tkinter.ttk", "tkinter.messagebox", "tkinter.filedialog", "tkinter.font", "_tkinter"):
        sys.modules[_name] = _Stub(_name)

from ardupilot_methodic_configurator.backend_filesystem import LocalFilesystem  # noqa: E402
from ardupilot_methodic_configurator.data_model_par_dict import ParDict  # noqa: E402
from ardupilot_methodic_configurator.data_model_parameter_editor import ParameterEditor  # noqa: E402

TEMPLATES = ROOT / "vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates"


def main() -> int:
    cases = []
    for components in sorted(TEMPLATES.glob("**/vehicle_components.json")):
        directory = components.parent
        data = json.loads(components.read_text(encoding="utf-8-sig"))
        vehicle_type = data["Components"]["Flight Controller"]["Firmware"]["Type"] or "ArduCopter"
        reader = LocalFilesystem.__new__(LocalFilesystem)
        reader.vehicle_dir = str(directory)
        file_parameters = LocalFilesystem.read_params_from_files(reader)
        default_file = directory / "00_default.param"
        defaults = ParDict.from_file(str(default_file)) if default_file.exists() else ParDict()
        with tempfile.TemporaryDirectory() as out:
            editor = ParameterEditor.__new__(ParameterEditor)
            editor._local_filesystem = SimpleNamespace(
                vehicle_type=vehicle_type,
                vehicle_dir=out,
                param_default_dict=defaults,
                file_parameters=file_parameters,
            )
            ParameterEditor._update_tuning_report(editor)
            csv = (Path(out) / "tuning_report.csv").read_bytes().decode("utf-8")
        cases.append(
            {"template": str(directory.relative_to(TEMPLATES)), "vehicleType": vehicle_type, "csv": csv}
        )
    json.dump({"amc": "v5.0.0", "cases": cases}, sys.stdout, indent=1)
    sys.stdout.write("\n")
    print(f"{len(cases)} templates", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
