#!/usr/bin/env python3
"""
Golden polynomial fits from numpy, for the TypeScript port to match.

AMC fits the IMU drift with `np.polyfit`, and the coefficients it produces go
to a flight controller. A fit that is merely plausible is not good enough, and
a test the port grades itself against proves nothing — so the expected values
come from the library AMC actually uses.
"""

import json
from pathlib import Path

import numpy as np

CASES = [
    # An exact cubic: the fit must recover it, not approximate it.
    ("exact cubic", [t - 35 for t in range(10, 61, 2)], lambda t: 2.5 + 0.1 * t - 0.003 * t**2 + 0.0001 * t**3),
    # A straight line, where the higher orders must come out at zero.
    ("linear", [t - 35 for t in range(0, 71, 5)], lambda t: 1.25 - 0.04 * t),
    # A constant: every order above zero is zero.
    ("constant", [t - 35 for t in range(5, 56, 3)], lambda _t: 0.0125),
    # Realistic gyro drift: small numbers where the scaling matters.
    ("gyro drift", [t - 35 for t in np.arange(-5, 65, 1.5)], lambda t: -0.0021 + 0.000_11 * t + 2.4e-7 * t**2),
    # Uneven spacing, because a real log samples as the airframe warms.
    ("uneven", [t - 35 for t in [5, 6, 8, 12, 19, 27, 40, 41, 43, 55, 56, 58, 60]],
     lambda t: 0.5 - 0.02 * t + 0.0009 * t**2 - 0.000_02 * t**3),
]

out = []
for name, xs, f in CASES:
    xs = [float(x) for x in xs]
    ys = [float(f(x)) for x in xs]
    # Highest order first, exactly as generate_calibration_file consumes it.
    coefficients = [float(c) for c in np.polyfit(np.array(xs), np.array(ys), 3)]
    out.append({"name": name, "x": xs, "y": ys, "coefficients": coefficients})

path = Path(__file__).resolve().parent.parent / "tests/fixtures/polyfit.json"
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
print(f"wrote {len(out)} golden fits to {path}")
