/**
 * The values already on the vehicle that a step is responsible for.
 *
 * Most steps compute parameters. Some also *capture* them: a step declares
 * patterns, and any parameter matching one whose value differs from the
 * firmware default belongs to that step's record. It is how the sequence takes
 * account of work done outside it -- an IMU temperature calibration run, a
 * compass calibration, anything set by another tool -- and files it under the
 * step that owns it rather than losing it.
 *
 * Mirrors `get_auto_importable_parameter_names` in
 * data_model_configuration_step.py, including the two details that are easy to
 * get wrong: the patterns are anchored at the start only, and the comparison
 * against the default is a tolerance, not equality.
 */

import type { ConfigurationStep } from './types.js'

/**
 * AMC's `is_within_tolerance`: `|x - y| <= atol + rtol * |y|`.
 *
 * A parameter read back over MAVLink is a 32-bit float, so a value that was
 * written as its default does not always compare equal to it.
 */
export function withinTolerance(value: number, reference: number, atol = 1e-8, rtol = 1e-4): boolean {
  return Math.abs(value - reference) <= atol + rtol * Math.abs(reference)
}

/**
 * Compile a step's patterns.
 *
 * Python's `re.match` anchors at the start and not at the end, so `TCAL_ENABLED`
 * also matches `TCAL_ENABLED_X`. Anchoring both ends here would silently drop
 * parameters the sequence means to capture.
 */
function compile(patterns: readonly string[]): RegExp[] {
  const compiled: RegExp[] = []
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(`^(?:${pattern})`))
    } catch {
      // A pattern this engine cannot compile captures nothing, rather than
      // taking the step down. JavaScript and Python regex differ at the edges.
    }
  }
  return compiled
}

/**
 * Which of the vehicle's parameters this step captures.
 *
 * `defaults` is the firmware's own default per parameter -- the app reads them
 * from `@PARAM/param.pck?withdefaults=1`. Without them nothing can be captured,
 * because "differs from default" is the whole test, and guessing which
 * parameters look unusual would be a different and much worse feature.
 */
export function autoImportableParameters(
  step: ConfigurationStep,
  parameters: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number> | undefined
): string[] {
  const patterns = step.autoimport_nondefault_regexp
  if (!patterns || patterns.length === 0 || !defaults || defaults.size === 0) return []

  const matchers = compile(patterns)
  if (matchers.length === 0) return []

  const captured: string[] = []
  for (const [name, value] of Object.entries(parameters)) {
    const fallback = defaults.get(name)
    // A parameter with no known default cannot be judged, and AMC skips it for
    // the same reason: it is not in the defaults file.
    if (fallback === undefined) continue
    if (!matchers.some((matcher) => matcher.test(name))) continue
    if (withinTolerance(value, fallback)) continue
    captured.push(name)
  }
  return captured.sort()
}

/**
 * Other step files whose recorded value for a freshly calibrated parameter no
 * longer matches the vehicle.
 *
 * AMC's `find_other_steps_with_stale_calibration_values`. The situation it is
 * for: a calibration is run, the flight controller now holds new numbers, and
 * every other step file in the directory still records the old ones. Those
 * files are now a record of something that is not true, and nothing else in
 * the directory notices.
 *
 * Reports only. AMC never rewrites the other files and neither does this: the
 * directory is the operator's account of how the aircraft was configured, and
 * silently editing steps they are not looking at is not a correction, it is a
 * forgery.
 */
export function stepsWithStaleCalibration(
  directory: Readonly<Record<string, Readonly<Record<string, number>>>>,
  currentStep: string | undefined,
  calibratedValues: Readonly<Record<string, number>>
): readonly string[] {
  const stale: string[] = []
  for (const [filename, recorded] of Object.entries(directory)) {
    // The step the calibration belongs to is being written right now; it is
    // not stale, it is the source.
    if (filename === currentStep) continue
    for (const [parameter, value] of Object.entries(calibratedValues)) {
      const held = recorded[parameter]
      if (held === undefined) continue
      if (!withinTolerance(held, value)) {
        stale.push(filename)
        break
      }
    }
  }
  return stale
}
