/**
 * What a configured vehicle ended up with.
 *
 * AMC closes a configuration by categorising every parameter that differs from
 * firmware default, and the categories are the point: they separate what
 * somebody chose from what the vehicle wrote about itself. A calibration
 * result is not a decision. Neither is a read-only value the firmware
 * maintains, nor the vehicle's own identity numbers.
 *
 * Mirrors `categorize_by_documentation` in data_model_par_dict.py.
 */

import type { ParameterDocs } from './docs.js'
import { withinTolerance } from './autoimport.js'

/**
 * The vehicle's own identity, which AMC keeps separate by name.
 *
 * Not derivable from the documentation -- these are ordinary writable
 * parameters that happen to say which aircraft this is, so sharing a
 * configuration means deciding about them deliberately.
 */
export const ID_PARAMETER_NAMES: ReadonlySet<string> = new Set([
  'SYSID_THISMAV',
  'SYSID_MYGCS',
  'FOLL_SYSID'
])

export type SummaryCategory = 'readOnly' | 'calibration' | 'identity' | 'chosen'

export interface SummaryEntry {
  readonly parameter: string
  readonly value: number
  readonly defaultValue: number
  readonly category: SummaryCategory
}

export interface ConfigurationSummary {
  /** Every parameter that differs from its firmware default. */
  readonly changed: readonly SummaryEntry[]
  /** Written by the firmware, not chosen: `@ReadOnly`. */
  readonly readOnly: readonly SummaryEntry[]
  /** Produced by a calibration: `@Calibration`. */
  readonly calibration: readonly SummaryEntry[]
  /** The vehicle's own identity numbers. */
  readonly identity: readonly SummaryEntry[]
  /** What is left: the decisions. */
  readonly chosen: readonly SummaryEntry[]
  /** Parameters compared, i.e. those whose default is known. */
  readonly compared: number
  /**
   * Whether the documentation carried the read-only and calibration flags.
   *
   * Without them those two categories are empty and their parameters fall into
   * `chosen`, which would quietly overstate how much was decided. The caller is
   * told rather than left to infer it.
   */
  readonly categoriesAvailable: boolean
}

/**
 * Categorise what this vehicle has that the firmware did not give it.
 *
 * `defaults` is the firmware's own default per parameter. Anything without a
 * known default is not compared at all: "differs from default" is the whole
 * basis, and a parameter whose default is unknown cannot be said to differ.
 */
export function summarize(
  parameters: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number> | undefined,
  docs: ParameterDocs | undefined
): ConfigurationSummary {
  const changed: SummaryEntry[] = []
  let compared = 0
  let sawFlags = false

  for (const [parameter, value] of Object.entries(parameters)) {
    const defaultValue = defaults?.get(parameter)
    if (defaultValue === undefined) continue
    compared += 1
    if (withinTolerance(value, defaultValue)) continue

    const doc = docs?.(parameter) as { readOnly?: boolean; calibration?: boolean } | undefined
    if (doc?.readOnly !== undefined || doc?.calibration !== undefined) sawFlags = true

    // Order matters and matches AMC's: read-only first, then calibration, then
    // identity, and whatever is left is a decision.
    const category: SummaryCategory = doc?.readOnly
      ? 'readOnly'
      : doc?.calibration
        ? 'calibration'
        : ID_PARAMETER_NAMES.has(parameter)
          ? 'identity'
          : 'chosen'

    changed.push({ parameter, value, defaultValue, category })
  }

  changed.sort((left, right) => left.parameter.localeCompare(right.parameter))
  const of = (category: SummaryCategory) => changed.filter((entry) => entry.category === category)

  return {
    changed,
    readOnly: of('readOnly'),
    calibration: of('calibration'),
    identity: of('identity'),
    chosen: of('chosen'),
    compared,
    categoriesAvailable: sawFlags
  }
}
