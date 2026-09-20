/**
 * Parameters ArduPilot renamed between firmware versions.
 *
 * A vehicle directory written against 4.5 and reopened against a 4.7 flight
 * controller names parameters the vehicle no longer has: `ANGLE_MAX` became
 * `ATC_ANGLE_MAX`, `EK3_MAX_FLOW` became `EK3_FLOW_MAX`. Without the rename,
 * reading that directory back silently drops the operator's values — the file
 * says one thing, the vehicle has another, and nothing reports the gap.
 *
 * Some renames also changed UNITS: `ANGLE_MAX` was centidegrees and
 * `ATC_ANGLE_MAX` is degrees, so the value is scaled as well as moved. A
 * rename that carried the number across unchanged would be worse than no
 * rename at all — it would look like it had worked.
 *
 * The tables are extracted from AMC's source rather than transcribed
 * (scripts/extract-connection-tables.py): 88 renames where a typo would
 * silently lose one.
 */

export interface UpgradeTables {
  /** 4.6: name-only renames. */
  readonly PARAM_UPGRADE_DICT_46?: Readonly<Record<string, string>>
  /** 4.7: `[newName, scale]` — the scale is 1 for a name-only rename. */
  readonly PARAM_UPGRADE_DICT_47?: Readonly<Record<string, readonly [string, number] | [string, number]>>
}

export interface ParameterRename {
  readonly from: string
  readonly to: string
  readonly value: number
  /** Present only when the rename also changed units. */
  readonly scale?: number
}

export interface UpgradeResult<T> {
  readonly parameters: ReadonlyMap<string, T>
  readonly renamed: readonly ParameterRename[]
}

/**
 * Which upgrades bridge the gap between two firmware versions.
 *
 * Only upgrades that the vehicle has crossed and the file has not: a 4.6 file
 * on a 4.6 vehicle needs nothing, and a file NEWER than the vehicle is not
 * downgraded — the operator would be the one to explain that, not us.
 */
export function upgradesBetween(fileVersion: string, vehicleVersion: string): readonly (4.6 | 4.7)[] {
  const from = parseVersion(fileVersion)
  const to = parseVersion(vehicleVersion)
  // An unknown version on either side means the gap cannot be established,
  // and renaming on a guess would move values that should have stayed put.
  if (from === undefined || to === undefined || to <= from) return []
  const crossed: (4.6 | 4.7)[] = []
  if (from < 4.6 && 4.6 <= to) crossed.push(4.6)
  if (from < 4.7 && 4.7 <= to) crossed.push(4.7)
  return crossed
}

/**
 * Apply the renames to a parameter map, keeping each entry's own shape.
 *
 * `valueOf`/`withValue` let this work over plain numbers or over the richer
 * entries a parsed `.param` file carries, without this module knowing about
 * either.
 */
export function upgradeParameters<T>(
  parameters: ReadonlyMap<string, T>,
  tables: UpgradeTables,
  crossed: readonly (4.6 | 4.7)[],
  valueOf: (entry: T) => number,
  withValue: (entry: T, value: number) => T
): UpgradeResult<T> {
  if (crossed.length === 0) return { parameters, renamed: [] }

  const out = new Map(parameters)
  const renamed: ParameterRename[] = []

  const rename = (from: string, to: string, scale: number): void => {
    const entry = out.get(from)
    if (entry === undefined) return
    // A directory that already holds the new name has been upgraded before;
    // renaming over it would replace the current value with a stale one.
    if (out.has(to)) {
      out.delete(from)
      return
    }
    const value = valueOf(entry)
    const scaled = scale === 1 ? value : value * scale
    out.delete(from)
    out.set(to, withValue(entry, scaled))
    renamed.push({ from, to, value: scaled, ...(scale === 1 ? {} : { scale }) })
  }

  if (crossed.includes(4.6)) {
    for (const [from, to] of Object.entries(tables.PARAM_UPGRADE_DICT_46 ?? {})) rename(from, to, 1)
  }
  if (crossed.includes(4.7)) {
    for (const [from, target] of Object.entries(tables.PARAM_UPGRADE_DICT_47 ?? {})) {
      rename(from, target[0], target[1])
    }
  }

  return { parameters: out, renamed }
}

/** `"4.6.1"` → 4.6. Only the major and minor decide which renames apply. */
function parseVersion(version: string): number | undefined {
  const match = /^\s*v?(\d+)\.(\d+)/.exec(version ?? '')
  if (!match) return undefined
  return Number(`${match[1]}.${match[2]}`)
}
