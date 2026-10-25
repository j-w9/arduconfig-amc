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
import { pyFloatRepr } from './python-json.js'
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

/** Heli also watches its feed-forward gains, which its tuning sets directly. */
const HELI_EXTRA_PARAMETERS: readonly string[] = ['ATC_RAT_PIT_FF', 'ATC_RAT_RLL_FF', 'ATC_RAT_YAW_FF']

/**
 * The steps that move them, in the order a tuning session goes.
 *
 * AMC 5.0.0 renumbered the sequence, so the columns depend on the vehicle:
 * Copter, Plane and Rover read the new numbers, and Heli -- whose tuning
 * became a sequence of its own -- has its own list. Kept as AMC's literals
 * (data_model_parameter_editor._update_tuning_report) rather than looked up,
 * because which steps count as "tuning" is AMC's editorial choice.
 */
function reportFiles(vehicleType: string): readonly string[] {
  if (vehicleType === 'Heli') {
    return [
      '00_default.param',
      '24_initial_atc.param',
      '40_optional_pid_adjustment.param',
      '43_autotune_roll_pitch_ff_results.param',
      '47_autotune_pitch_rate_pd_results.param',
      '51_autotune_roll_rate_pd_results.param',
      '54_quick_tune_results.param',
      '55_autotune_roll_pitch_angle_p_results.param',
      '63_autotune_yaw_angle_p_results.param',
      '64_autotune_roll_results.param',
      '66_autotune_pitch_results.param',
      '68_autotune_yaw_results.param',
      '70_autotune_yawd_results.param',
      '72_autotune_roll_pitch_retune_results.param'
    ]
  }
  const usesV2Steps = vehicleType === 'ArduCopter' || vehicleType === 'ArduPlane' || vehicleType === 'Rover'
  const pairs: readonly (readonly [string, string])[] = [
    ['23_optional_pid_adjustment.param', '27_optional_pid_adjustment.param'],
    ['30_quick_tune_results.param', '34_quick_tune_results.param'],
    ['36_autotune_roll_results.param', '40_autotune_roll_results.param'],
    ['38_autotune_pitch_results.param', '42_autotune_pitch_results.param'],
    ['40_autotune_yaw_results.param', '44_autotune_yaw_results.param'],
    ['42_autotune_yawd_results.param', '46_autotune_yawd_results.param'],
    ['44_autotune_roll_pitch_retune_results.param', '48_autotune_roll_pitch_retune_results.param']
  ]
  return [
    '00_default.param',
    vehicleType === 'Rover' ? '17_initial_atc.param' : '13_initial_atc.param',
    ...pairs.map(([legacy, current]) => (usesV2Steps ? current : legacy))
  ]
}

function reportParameters(vehicleType: string): readonly string[] {
  return vehicleType === 'Heli' ? [...REPORT_PARAMETERS, ...HELI_EXTRA_PARAMETERS] : REPORT_PARAMETERS
}

/**
 * Build the grid.
 *
 * A step that set nothing for a parameter leaves its cell EMPTY rather than
 * repeating the previous value: the file is a record of what each step
 * changed, and carrying a value forward would invent a decision no step made.
 *
 * Written as Python's csv module writes it -- CRLF line endings, values as
 * `str(float)` -- so the file is the one AMC would write for the same
 * directory.
 */
export function tuningReport(
  files: readonly VehicleFile[],
  defaults?: ReadonlyMap<string, number>,
  vehicleType = 'ArduCopter'
): VehicleFile {
  const byFilename = new Map(files.map((file) => [file.filename, parseParamFile(file.text)]))
  const columns = reportFiles(vehicleType)
  const parameters = reportParameters(vehicleType)

  const rows = [['param', ...columns]]
  for (const parameter of parameters) {
    const row = [parameter]
    for (const filename of columns) {
      const value =
        filename === '00_default.param' ? defaults?.get(parameter) : byFilename.get(filename)?.get(parameter)?.value
      row.push(value === undefined ? '' : pyFloatRepr(value))
    }
    rows.push(row)
  }

  const text = rows.map((row) => `${row.map(csvCell).join(',')}\r\n`).join('')
  return { filename: 'tuning_report.csv', text, count: parameters.length, incomplete: 0 }
}

/** Whether this vehicle's directory has any tuning history worth reporting. */
export function hasTuningHistory(
  files: readonly VehicleFile[],
  defaults?: ReadonlyMap<string, number>,
  vehicleType = 'ArduCopter'
): boolean {
  const parameters = reportParameters(vehicleType)
  const columns = reportFiles(vehicleType)
  if (parameters.some((parameter) => defaults?.has(parameter))) return true
  return files.some(
    (file) =>
      columns.includes(file.filename) &&
      [...parseParamFile(file.text).keys()].some((name) => parameters.includes(name))
  )
}

/** csv.QUOTE_MINIMAL: quote a field holding the delimiter, a quote or a line break. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
