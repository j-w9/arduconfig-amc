"""What AMC 5.0.0 makes of a project an older AMC wrote, opened the normal way.

Opening a project in AMC runs two things in order
(data_model_vehicle_project_opener.open_vehicle_directory): first
backend_filesystem_migration.migrate_vehicle_project_if_needed, which moves
parameters between files, restores step files the project lacks from the
matching empty template and deletes retired files; then
LocalFilesystem.rename_parameter_files (inside re_init), which applies the
`old_filenames` aliases. The TypeScript port in packages/amc-steps/src/migrate.ts
is checked against the directory both leave behind, byte for byte.

The corpus is real: every vehicle template AMC 4.5.7 shipped, which is format
version 1 -- exactly what an operator who used 4.5.7 has on disk. Read from the
vendor checkout's history, so nothing here is transcribed. A few constructed
variants cover what no template exercises: an empty placeholder under the new
name, a destination the operator already filled in, an unmapped parameter, CRLF
line endings and a byte-order mark, a project with no firmware version (no
template restore), and the v0 directory carried all the way to v2.

Run from the repository root with a Python 3.10+ interpreter that has AMC's
dependencies installed:
    python scripts/gen_migration_v2_fixture.py | gzip -9n > tests/fixtures/migration-v2.json.gz
"""

import contextlib
import io
import json
import logging
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor/MethodicConfigurator"
sys.path.insert(0, str(VENDOR))

from ardupilot_methodic_configurator.backend_filesystem import LocalFilesystem  # noqa: E402
from ardupilot_methodic_configurator.backend_filesystem_configuration_steps import ConfigurationSteps  # noqa: E402
from ardupilot_methodic_configurator.backend_filesystem_migration import migrate_vehicle_project_if_needed  # noqa: E402

logging.disable(logging.CRITICAL)

OLD_RELEASE = "v4.5.7"
TEMPLATES = "ardupilot_methodic_configurator/vehicle_templates"
# The firmware-wide documentation is never touched by a migration and is
# megabytes per template; per-step .pdef.xml sidecars are kept, since the
# rename and the template restore both move them.
SKIPPED = ("apm.pdef.xml",)
KEPT_SUFFIXES = (".param", ".json", ".pdef.xml")


def old_templates() -> dict[str, dict[str, bytes]]:
    """Every project directory in the old release's templates, as name -> bytes."""
    archive = subprocess.run(
        ["git", "-C", str(VENDOR), "archive", "--format=tar", OLD_RELEASE, TEMPLATES],
        check=True,
        capture_output=True,
    ).stdout
    projects: dict[str, dict[str, bytes]] = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            relative = member.name[len(TEMPLATES) + 1 :]
            directory, _, name = relative.rpartition("/")
            if name in SKIPPED or not name.endswith(KEPT_SUFFIXES):
                continue
            projects.setdefault(directory, {})[name] = tar.extractfile(member).read()
    return {d: files for d, files in sorted(projects.items()) if "vehicle_components.json" in files}


def open_like_amc(files: dict[str, bytes]) -> dict[str, bytes]:
    """Write the directory, open it the way AMC does, and return what is left."""
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        for name, content in files.items():
            (directory / name).write_bytes(content)
        migrate_vehicle_project_if_needed(str(directory))

        # rename_parameter_files as re_init runs it: against the configuration
        # steps ConfigurationSteps.re_init would load for this vehicle type.
        components = json.loads((directory / "vehicle_components.json").read_text(encoding="utf-8-sig"))
        vehicle_type = (
            components.get("Components", {}).get("Flight Controller", {}).get("Firmware", {}).get("Type", "")
            or "ArduCopter"
        )
        filesystem = LocalFilesystem.__new__(LocalFilesystem)
        filesystem.log_loaded_file = False
        with contextlib.redirect_stdout(io.StringIO()):
            ConfigurationSteps.re_init(filesystem, str(directory), vehicle_type)
        filesystem.vehicle_dir = str(directory)
        filesystem.rename_parameter_files()

        return {path.name: path.read_bytes() for path in sorted(directory.iterdir()) if path.is_file()}


def text(files: dict[str, bytes]) -> dict[str, str]:
    # Decoded strictly: every file here is UTF-8, and a decoding error is a
    # corpus problem worth stopping for rather than papering over.
    return {name: content.decode("utf-8") for name, content in files.items()}


def with_components(files: dict[str, bytes], update) -> dict[str, bytes]:
    components = json.loads(files["vehicle_components.json"].decode("utf-8-sig"))
    update(components)
    return {**files, "vehicle_components.json": (json.dumps(components, indent=4) + "\n").encode()}


def variants(projects: dict[str, dict[str, bytes]]) -> list[tuple[str, dict[str, bytes]]]:
    """Constructed cases, each a small change to a real project."""
    cases: list[tuple[str, dict[str, bytes]]] = []
    copter = projects["ArduCopter/empty_4.6.x"]
    plane = next(files for name, files in projects.items() if name.startswith("ArduPlane/"))
    rover = next(files for name, files in projects.items() if name.startswith("Rover/"))

    # An empty file already under the new name: AMC replaces the placeholder
    # with the operator's legacy step rather than refusing the rename.
    cases.append(("variant/copter-empty-placeholder", {**copter, "15_board_orientation.param": b""}))

    # A destination the operator already filled in, with a value that
    # disagrees with the one moving in. Whether the move overwrites it depends
    # on the file order and the move's force flag.
    cases.append(
        (
            "variant/copter-destination-exists",
            {
                **copter,
                "16_accelerometer_calibration.param": b"INS_ACCOFFS_X,0.5  # already here\nINS_USE,0\n",
                "24_safety_setup.param": b"FENCE_ALT_MAX,77\nFENCE_ENABLE,0\n",
            },
        )
    )

    # Something in the old combined step that no move claims. AMC surfaces
    # it in the general configuration step rather than losing it.
    hardware = copter["14_mp_setup_mandatory_hardware.param"]
    cases.append(
        (
            "variant/copter-unmapped",
            {**copter, "14_mp_setup_mandatory_hardware.param": hardware + b"ZZ_UNKNOWN_PARAM,3  # mine\n"},
        )
    )
    plane_hardware = plane["14_mp_setup_mandatory_hardware.param"]
    cases.append(
        (
            "variant/plane-unmapped",
            {**plane, "14_mp_setup_mandatory_hardware.param": plane_hardware + b"ZZ_UNKNOWN_PARAM,3\n"},
        )
    )

    # Windows line endings and a byte-order mark on the file being split.
    crlf = b"\xef\xbb\xbf" + hardware.replace(b"\n", b"\r\n")
    cases.append(("variant/copter-crlf-bom", {**copter, "14_mp_setup_mandatory_hardware.param": crlf}))

    # Inline comments, tab and space separators, and comment-only lines.
    mixed = b"# a comment line\nCOMPASS_USE\t1\nAHRS_TRIM_X 0.01  # levelled\nFLTMODE1,5 # loiter\n\n"
    cases.append(("variant/rover-mixed-separators", {**rover, "14_mp_setup_mandatory_hardware.param": mixed}))

    # No firmware version: the migration still splits, but there is no
    # template to restore missing steps from.
    def drop_version(components):
        components["Components"]["Flight Controller"]["Firmware"]["Version"] = ""

    cases.append(("variant/copter-no-version", with_components(copter, drop_version)))

    # A firmware with no matching empty template.
    def odd_version(components):
        components["Components"]["Flight Controller"]["Firmware"]["Version"] = "4.2.3"

    cases.append(("variant/copter-no-template", with_components(copter, odd_version)))

    # The pre-v1 directory, carried through both migrations.
    v0 = json.loads((ROOT / "tests/fixtures/v0-directory.json").read_text(encoding="utf-8"))
    v0_files = {name: content.encode() for name, content in v0.items()}

    def v0_firmware(components):
        components["Components"]["Flight Controller"]["Firmware"]["Version"] = "4.6.3"

    cases.append(("variant/v0-to-v2", with_components(v0_files, v0_firmware)))
    cases.append(("variant/v0-to-v2-no-version", v0_files))

    # Already current: nothing may change.
    current = with_components(copter, lambda c: c.update({"Format version": 2}))
    cases.append(("variant/already-v2", current))
    return cases


def main() -> int:
    projects = old_templates()
    cases = [(f"template/{name}", files) for name, files in projects.items()] + variants(projects)
    out = []
    for name, files in cases:
        result = open_like_amc(files)
        before, after = text(files), text(result)
        # Only what changed is stored: most of a migrated directory is the
        # input untouched, and the fixture is committed.
        out.append(
            {
                "name": name,
                "input": before,
                "changed": {k: v for k, v in after.items() if before.get(k) != v},
                "removed": sorted(set(before) - set(after)),
            }
        )
    json.dump({"amc": "v5.0.0", "from": OLD_RELEASE, "cases": out}, sys.stdout, indent=0, sort_keys=True)
    sys.stdout.write("\n")
    print(f"{len(out)} projects", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
