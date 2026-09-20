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
