"""What AMC's own migration makes of a directory an older AMC wrote.

The TypeScript port in packages/amc-steps/src/migrate.ts is checked against
this, byte for byte. The input is a small synthetic v0 directory rather than a
vendored one because AMC ships no pre-v1 example -- the format changed before
the templates were regenerated -- so the corpus has to be constructed, and the
answers still come from AMC rather than from me.

Run with a Python 3.10+ interpreter that has AMC's dependencies:
    python3 scripts/gen_migration_fixture.py tests/fixtures/v0-directory.json \
        > tests/fixtures/v0-migrated.json
"""
import json, sys, tempfile, os
from pathlib import Path
sys.path.insert(0, "vendor/MethodicConfigurator")
from ardupilot_methodic_configurator.backend_filesystem_migration import migrate_vehicle_project_if_needed

FILES = json.load(open(sys.argv[1]))
with tempfile.TemporaryDirectory() as d:
    for name, text in FILES.items():
        Path(d, name).write_text(text, encoding="utf-8")
    migrated = migrate_vehicle_project_if_needed(d)
    out = {"migrated": migrated, "files": {}}
    for p in sorted(Path(d).iterdir()):
        out["files"][p.name] = p.read_text(encoding="utf-8")
    print(json.dumps(out, indent=1, sort_keys=True))
