#!/usr/bin/env bash
# Build ArduPilot SITL as WebAssembly, for the browser SITL tab.
#
# The vehicle firmware runs in the tab: no process, no socket, no bridge.
# ArduPilot's own `--board wasm` target (libraries/AP_HAL_SITL/hwdef/wasm)
# produces an Emscripten module whose MAVLink console is a pair of exported
# functions, which packages/transport/src/wasm-sitl-transport.ts reads and
# writes. This script is what produces those artifacts, so they are something
# anyone can regenerate rather than binaries of unknown provenance.
#
#   scripts/build-sitl-wasm.sh [vehicle ...]     default: copter plane
#
# Environment:
#   ARDUPILOT_REPO   an existing ArduPilot checkout to build from.
#                    Cloned into the work directory when unset.
#   EMSDK_DIR        an existing emsdk. Installed into the work directory
#                    when unset.
#   WORK_DIR         where clones and builds live (default: .sitl-build)
#
# Notes that cost time to rediscover:
#   - emsdk needs Python 3.10+, and waf needs empy 3.3.4 in the SAME
#     interpreter. A venv is created for this; symlinking a venv's python
#     elsewhere breaks it, because venv resolution needs pyvenv.cfg beside
#     the executable.
#   - Only ArduPlane is built in ArduPilot's own CI. Copter builds too --
#     that is why it is the default here -- but nothing upstream guards it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${WORK_DIR:-$ROOT/.sitl-build}"
DEST="$ROOT/sitl"
VEHICLES=("${@:-}")
if [ -z "${VEHICLES[0]:-}" ]; then VEHICLES=(copter plane); fi

mkdir -p "$WORK_DIR"

# --- Python 3.10+ with empy, which waf's code generation needs --------------
PYTHON_BIN="${PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
  for candidate in python3.14 python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1; then PYTHON_BIN="$(command -v "$candidate")"; break; fi
  done
fi
if [ -z "$PYTHON_BIN" ]; then
  echo "need Python 3.10 or newer on PATH (emsdk refuses older, and so does waf's empy)" >&2
  exit 1
fi

VENV="$WORK_DIR/venv"
if [ ! -x "$VENV/bin/python" ]; then
  echo "==> creating build venv with $("$PYTHON_BIN" --version)"
  "$PYTHON_BIN" -m venv "$VENV"
  "$VENV/bin/pip" install -q "empy==3.3.4" pexpect future pyserial
fi
# The venv's bin goes on PATH rather than being symlinked: a venv python
# resolves its packages relative to its own directory.
export PATH="$VENV/bin:$PATH"

# --- Emscripten -------------------------------------------------------------
EMSDK_DIR="${EMSDK_DIR:-$WORK_DIR/emsdk}"
if [ ! -d "$EMSDK_DIR" ]; then
  echo "==> installing emsdk"
  git clone -q --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
  (cd "$EMSDK_DIR" && ./emsdk install latest >/dev/null && ./emsdk activate latest >/dev/null)
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
echo "==> emcc $(emcc --version | head -1 | sed 's/.*) //')"

# --- ArduPilot --------------------------------------------------------------
AP="${ARDUPILOT_REPO:-$WORK_DIR/ardupilot}"
if [ ! -d "$AP" ]; then
  echo "==> cloning ArduPilot (shallow, with submodules; this is ~1.4 GB)"
  git clone -q --depth 1 --recurse-submodules --shallow-submodules \
    https://github.com/ArduPilot/ardupilot.git "$AP"
fi
if [ ! -f "$AP/libraries/AP_HAL_SITL/hwdef/wasm/hwdef.dat" ]; then
  echo "$AP has no --board wasm target; it predates the WebAssembly HAL" >&2
  exit 1
fi

# --- Build ------------------------------------------------------------------
cd "$AP"
echo "==> waf configure --board wasm"
./waf configure --board wasm >/dev/null

mkdir -p "$DEST"
for vehicle in "${VEHICLES[@]}"; do
  target="ardu${vehicle}"
  echo "==> building $target"
  ./waf build --target "bin/$target" >/dev/null
  cp "build/wasm/bin/$target.js" "build/wasm/bin/$target.wasm" "$DEST/"
  echo "    $(ls -lh "$DEST/$target.wasm" | awk '{print $5}')  $target.wasm"
done

# The commit these were built from, so a binary in git can always be traced
# back to a source tree.
{
  echo "ardupilot_commit=$(git -C "$AP" rev-parse HEAD)"
  echo "emcc_version=$(emcc --version | head -1)"
  echo "vehicles=${VEHICLES[*]}"
  echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$DEST/PROVENANCE.txt"

echo "==> wrote $(ls "$DEST" | wc -l | tr -d ' ') files to sitl/"
