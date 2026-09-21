/**
 * How the tuning moved, step by step.
 *
 * Tuning a multirotor is the long part of the method: an initial guess, a
 * quick-tune, then autotune runs for roll, pitch and yaw, each overwriting
 * the last. The per-step files record each of those separately, which makes
 * the one question an operator actually asks — did this get better or worse,
 * and when? — a matter of opening nine files side by side.
 *
 * So AMC writes a grid: a row per tuning parameter, a column per tuning step,
 * starting from the firmware default. Reading across a row is the history of
 * one gain.
 *
 * The parameters and the steps are AMC's list rather than everything that
 * could be tuned, and that is the point: a grid of every parameter would be
 * as unreadable as the files it replaces.
 */

import { parseParamFile } from './param-file.js'
import type { VehicleFile } from './vehicle-files.js'

/** The gains worth watching across a tuning session. */
const REPORT_PARAMETERS: readonly string[] = [
  'ATC_ACCEL_P_MAX',
  'ATC_ACCEL_R_MAX',
  'ATC_ACCEL_Y_MAX',
  'ATC_ANG_PIT_P',
  'ATC_ANG_RLL_P',
  'ATC_ANG_YAW_P',
  'ATC_RAT_PIT_FLTD',
  'ATC_RAT_PIT_FLTE',
  'ATC_RAT_PIT_FLTT',
  'ATC_RAT_RLL_FLTD',
  'ATC_RAT_RLL_FLTE',
  'ATC_RAT_RLL_FLTT',
  'ATC_RAT_YAW_FLTD',
  'ATC_RAT_YAW_FLTE',
  'ATC_RAT_YAW_FLTT',
  'ATC_RAT_PIT_D',
  'ATC_RAT_PIT_I',
  'ATC_RAT_PIT_P',
  'ATC_RAT_RLL_D',
  'ATC_RAT_RLL_I',
  'ATC_RAT_RLL_P',
  'ATC_RAT_YAW_D',
  'ATC_RAT_YAW_I',
  'ATC_RAT_YAW_P',
  'INS_ACCEL_FILTER',
  'INS_GYRO_FILTER'
]

/** The steps that move them, in the order a tuning session goes. */
const REPORT_FILES: readonly string[] = [
  '00_default.param',
  '13_initial_atc.param',
  '23_optional_pid_adjustment.param',
  '30_quick_tune_results.param',
  '36_autotune_roll_results.param',
  '38_autotune_pitch_results.param',
  '40_autotune_yaw_results.param',
  '42_autotune_yawd_results.param',
  '44_autotune_roll_pitch_retune_results.param'
]

/**
 * Build the grid.
 *
 * A step that set nothing for a parameter leaves its cell EMPTY rather than
 * repeating the previous value: the file is a record of what each step
 * changed, and carrying a value forward would invent a decision no step made.
 */
export function tuningReport(
  files: readonly VehicleFile[],
  defaults?: ReadonlyMap<string, number>
): VehicleFile {
  const byFilename = new Map(files.map((file) => [file.filename, parseParamFile(file.text)]))

  const rows = [['param', ...REPORT_FILES]]
  for (const parameter of REPORT_PARAMETERS) {
    const row = [parameter]
    for (const filename of REPORT_FILES) {
      if (filename === '00_default.param') {
        const value = defaults?.get(parameter)
        row.push(value === undefined ? '' : String(value))
        continue
      }
      const entry = byFilename.get(filename)?.get(parameter)
      row.push(entry === undefined ? '' : String(entry.value))
    }
    rows.push(row)
  }

  const text = `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
  return { filename: 'tuning_report.csv', text, count: REPORT_PARAMETERS.length, incomplete: 0 }
}

/** Whether this vehicle's directory has any tuning history worth reporting. */
export function hasTuningHistory(
  files: readonly VehicleFile[],
  defaults?: ReadonlyMap<string, number>
): boolean {
  if (REPORT_PARAMETERS.some((parameter) => defaults?.has(parameter))) return true
  return files.some(
    (file) =>
      REPORT_FILES.includes(file.filename) &&
      [...parseParamFile(file.text).keys()].some((name) => REPORT_PARAMETERS.includes(name))
  )
}

/** Parameter names and numbers need no quoting, but a comment could. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
