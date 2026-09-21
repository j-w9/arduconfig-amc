/**
 * The values a directory starts from, before the sequence edits any of them.
 *
 * AMC does not compute a vehicle directory from nothing. It copies a
 * template's `.param` files and then lets the step directives override what
 * they have an opinion about, which is why an AMC directory holds far more
 * than the sequence decides -- 69 of the 662 parameters in `empty_4.6.x` come
 * from directives and the rest are the template's.
 *
 * Which template matters. Copying a *real* aircraft's would assert its antenna
 * offsets and port wiring as this vehicle's. AMC's own answer, when it creates
 * a project from a connected flight controller, is the EMPTY template for that
 * firmware -- `empty_<major>.<minor>.x`
 * (`data_model_vehicle_project._get_fc_template_dir_for_project_creation`).
 * That is firmware-shaped starting values with none of the geometry, tuning or
 * wiring that belongs to whoever contributed a real template, and it is the
 * baseline this carries across.
 */

import { parseParamFile } from './param-file.js'

/** `steps/baselines.json`: vehicle, then `major.minor`, then filename to text. */
export interface BaselineTable {
  readonly [vehicle: string]: {
    readonly [version: string]: { readonly [filename: string]: string }
  }
}

export interface Baseline {
  /** The firmware the baseline is for, as `4.6`. */
  readonly version: string
  /** Each step's starting values, by filename. */
  readonly files: ReadonlyMap<string, ReadonlyMap<string, number>>
  /** How many parameters it carries in total. */
  readonly count: number
}

/**
 * `4.6.3 (official)` and `4.6` alike reduce to `4.6`.
 *
 * The firmware version arrives from the link as whatever the vehicle reports,
 * and the templates are named by the release line rather than the patch.
 */
export function releaseLine(version: string | undefined): string | undefined {
  if (!version) return undefined
  const match = /(\d+)\.(\d+)/.exec(version)
  return match ? `${match[1]}.${match[2]}` : undefined
}

/**
 * The baseline for a vehicle on a firmware version, if AMC ships one.
 *
 * Exact match only, as AMC does: it raises rather than falling back to a
 * neighbouring release, because a 4.5 baseline on 4.7 firmware would seed
 * parameters that have since been renamed. Returns undefined here instead of
 * throwing -- a directory with no baseline is the old behaviour, not an error.
 */
export function baselineFor(
  table: BaselineTable,
  vehicle: string,
  version: string | undefined
): Baseline | undefined {
  const line = releaseLine(version)
  if (!line) return undefined
  const files = table[vehicle]?.[line]
  if (!files) return undefined

  const parsed = new Map<string, ReadonlyMap<string, number>>()
  let count = 0
  for (const [filename, text] of Object.entries(files)) {
    const values = new Map<string, number>()
    for (const entry of parseParamFile(text).values()) {
      values.set(entry.name, entry.value)
      count += 1
    }
    if (values.size > 0) parsed.set(filename, values)
  }

  return { version: line, files: parsed, count }
}

/** Which firmware lines a vehicle has a baseline for, in order. */
export function baselineVersions(table: BaselineTable, vehicle: string): readonly string[] {
  return Object.keys(table[vehicle] ?? {}).sort((a, b) => {
    const [aMajor = 0, aMinor = 0] = a.split('.').map(Number)
    const [bMajor = 0, bMinor = 0] = b.split('.').map(Number)
    return aMajor - bMajor || aMinor - bMinor
  })
}
