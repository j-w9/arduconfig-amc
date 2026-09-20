/**
 * Assembling a vehicle's configuration directory.
 *
 * One file per step, named as the sequence names it, holding the parameters
 * that step is responsible for: the ones it computes, and the ones it captures
 * from a vehicle that already has them. Each line carries the reason the
 * sequence gives, because a value without a reason is the thing this whole
 * method exists to avoid.
 *
 * A step that decides nothing still gets a file. An empty `18_osd.param` says
 * the step was considered and had nothing to set, which is a different and more
 * useful statement than the file being absent.
 */

import { autoImportableParameters } from './autoimport.js'
import type { ParameterDocs } from './docs.js'
import type { OrderedStep } from './types.js'
import { parseParamFile } from './param-file.js'
import { type ParamLine, writeParamFile } from './param-file-writer.js'
import { applyStep } from './run.js'
import type { VehicleContext } from './run.js'

export interface VehicleFilesOptions {
  readonly docs?: ParameterDocs
  /** The firmware's own defaults, needed before a step can capture anything. */
  readonly defaults?: ReadonlyMap<string, number>
  /** The vehicle's live parameters, for the values a step captures. */
  readonly parameters?: Readonly<Record<string, number>>
  /**
   * Values the operator chose over the sequence's, by parameter name.
   *
   * Written with the `@manual_override` marker, so reading the directory back
   * does not undo the decision.
   */
  readonly overrides?: ReadonlyMap<string, { value: number; reason?: string }>
}

export interface VehicleFile {
  readonly filename: string
  readonly text: string
  /** How many parameters the file holds, for a caller that wants to say so. */
  readonly count: number
  /** Directives the step could not evaluate, so a caller can refuse to write. */
  readonly incomplete: number
}

/**
 * Build the directory.
 *
 * Deliberately returns text rather than writing anything: where a vehicle
 * directory lives -- a download, a directory handle, a zip -- is the caller's
 * problem, and keeping it out of here is what makes the result testable
 * against AMC's own files.
 */
export function vehicleFiles(
  sequence: readonly OrderedStep[],
  context: VehicleContext,
  options: VehicleFilesOptions = {}
): VehicleFile[] {
  const { docs, defaults, parameters = {}, overrides } = options

  return sequence.map(({ filename, step }) => {
    const outcome = applyStep(step, context, docs ? { docs } : {})
    const lines = new Map<string, ParamLine>()

    for (const change of outcome.changes) {
      lines.set(change.parameter, {
        name: change.parameter,
        value: change.value,
        ...(change.reason === undefined ? {} : { comment: change.reason })
      })
    }

    // What the vehicle already had that this step is responsible for. Added
    // after the computed values and never over them: a step that both sets a
    // parameter and captures it means the set value is the intent.
    for (const captured of autoImportableParameters(step, parameters, defaults)) {
      if (lines.has(captured)) continue
      lines.set(captured, {
        name: captured,
        value: parameters[captured] as number,
        comment: 'Read from the flight controller'
      })
    }

    // The operator's own decisions win over both, and say so in the file.
    for (const [name, override] of overrides ?? []) {
      if (!lines.has(name)) continue
      lines.set(name, {
        name,
        value: override.value,
        manualOverride: true,
        ...(override.reason === undefined ? {} : { comment: override.reason })
      })
    }

    return {
      filename,
      text: writeParamFile([...lines.values()]),
      count: lines.size,
      incomplete: outcome.failures.length
    }
  })
}

/**
 * The firmware's defaults, as `00_default.param`.
 *
 * AMC keeps this so a configuration can be read later by someone without the
 * aircraft: without it there is no way to tell which of its values were chosen.
 */
export function defaultsFile(defaults: ReadonlyMap<string, number>): VehicleFile {
  const lines = [...defaults].map(([name, value]) => ({ name, value }))
  return {
    filename: '00_default.param',
    text: writeParamFile(lines),
    count: lines.length,
    incomplete: 0
  }
}

/**
 * Boot-time calibration results, which are the vehicle's own writing.
 *
 * These are produced by a calibration rather than chosen by anyone, and they
 * belong to the airframe that was calibrated. Carrying them into a file that
 * says "here is what your vehicle has that the sequence did not set" would be
 * noise at best — and, if that file were ever replayed onto different
 * hardware, an accelerometer offset from another aircraft.
 */
const BOOT_CALIBRATION_PARAMETERS: ReadonlySet<string> = new Set([
  'COMPASS_DEC',
  'INS_ACC1_CALTEMP',
  'INS_ACC2_CALTEMP',
  'INS_ACC2OFFS_X',
  'INS_ACC2OFFS_Y',
  'INS_ACC2OFFS_Z',
  'INS_ACC3SCAL_X',
  'INS_ACC3SCAL_Y',
  'INS_ACC3SCAL_Z',
  'INS_ACCOFFS_X',
  'INS_ACCOFFS_Y',
  'INS_ACCOFFS_Z',
  'INS_GYR1_CALTEMP',
  'INS_GYR2_CALTEMP',
  'INS_GYR3_CALTEMP',
  'INS_GYR2OFFS_X',
  'INS_GYR2OFFS_Y',
  'INS_GYR2OFFS_Z',
  'INS_GYR3OFFS_X',
  'INS_GYR3OFFS_Y',
  'INS_GYR3OFFS_Z',
  'INS_GYROFFS_X',
  'INS_GYROFFS_Y',
  'INS_GYROFFS_Z'
])

export interface UnaccountedOptions {
  /** The firmware's own defaults; a value still at its default was not chosen. */
  readonly defaults?: ReadonlyMap<string, number>
  /** Fraction a value may differ by and still count as the same. */
  readonly tolerance?: number
}

/**
 * The vehicle's parameters that the sequence's files do not account for.
 *
 * The directory says what the method decided. This says what is on the
 * aircraft that the method did NOT decide — a value someone set by hand, a
 * tab elsewhere in this app, or an earlier configuration nobody wrote down.
 *
 * It is the question an operator is left with once the sequence is complete
 * ("is that everything?") and the honest answer is usually no. Without it the
 * directory quietly implies it describes the whole vehicle.
 */
export function unaccountedParameters(
  files: readonly VehicleFile[],
  parameters: Readonly<Record<string, number>>,
  options: UnaccountedOptions = {}
): VehicleFile {
  const { defaults, tolerance = 1e-6 } = options

  // Every parameter the sequence's files set, at the value they leave it.
  const accounted = new Map<string, number>()
  for (const file of files) {
    if (file.filename === '00_default.param') continue
    for (const entry of parseParamFile(file.text).values()) accounted.set(entry.name, entry.value)
  }

  const lines: ParamLine[] = []
  for (const [name, value] of Object.entries(parameters)) {
    if (BOOT_CALIBRATION_PARAMETERS.has(name)) continue
    // Still at the firmware's default: nobody chose it, so there is nothing
    // for the sequence to have failed to account for.
    const def = defaults?.get(name)
    if (def !== undefined && sameWithin(def, value, tolerance)) continue

    const expected = accounted.get(name)
    if (expected !== undefined && sameWithin(expected, value, tolerance)) continue
    lines.push({
      name,
      value,
      comment: expected === undefined ? 'Not set by any step' : `A step sets this to ${expected}`
    })
  }

  lines.sort((a, b) => a.name.localeCompare(b.name))
  return {
    filename: 'fc_params_not_accounted_for.param',
    text: writeParamFile(lines),
    count: lines.length,
    incomplete: 0
  }
}

function sameWithin(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= Math.max(tolerance, Math.abs(a) * tolerance)
}
