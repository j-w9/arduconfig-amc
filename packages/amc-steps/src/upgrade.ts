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

/**
 * Stream-rate parameters, which 4.6 renamed by POSITION rather than by name.
 *
 * `SR0_*` through `SR6_*` set how often a serial port streams telemetry, and
 * 4.6 replaced them with `MAV1_*`, `MAV2_*` and so on — numbered by which
 * MAVLink port a serial is, not by which serial it is. A vehicle with MAVLink
 * on SERIAL1 and SERIAL2 maps `SR1_` to `MAV1_` and `SR2_` to `MAV2_`; one
 * with MAVLink only on SERIAL2 maps `SR2_` to `MAV1_`.
 *
 * So the rename cannot come from a table: it depends on the vehicle's own
 * `SERIAL*_PROTOCOL` values. Reading a pre-4.6 directory without this drops
 * every stream-rate the operator set, silently — and an audit against AMC's
 * tables is how this turned up, because the static renames alone looked
 * complete.
 */
export function streamRateRenames(
  parameters: ReadonlyMap<string, { readonly value: number }> | Readonly<Record<string, number>>,
  mavlinkProtocols: readonly number[]
): ReadonlyMap<string, string> {
  const protocols = new Set(mavlinkProtocols)
  const ports: number[] = []

  const entries: [string, number][] =
    parameters instanceof Map
      ? [...parameters].map(([name, entry]) => [name, entry.value])
      : Object.entries(parameters)

  for (const [name, value] of entries) {
    const match = /^SERIAL(\d+)_PROTOCOL$/.exec(name)
    if (!match) continue
    if (!protocols.has(Math.trunc(value))) continue
    ports.push(Number(match[1]))
  }

  // Sorted, because "first MAVLink port" means lowest-numbered and a Map's
  // insertion order is whatever the file happened to be written in.
  ports.sort((a, b) => a - b)

  const renames = new Map<string, string>()
  ports.forEach((port, index) => {
    renames.set(`SR${port}_`, `MAV${index + 1}_`)
  })
  return renames
}

/** The SERIAL protocol numbers that mean MAVLink, from AMC's own table. */
export function mavlinkProtocolNumbers(
  serialProtocols: Readonly<Record<string, { readonly protocol: string }>>
): number[] {
  return Object.entries(serialProtocols)
    .filter(([, entry]) => entry.protocol.startsWith('MAVLink'))
    .map(([value]) => Number(value))
    .filter((value) => Number.isFinite(value))
}

/**
 * Apply the stream-rate renames to a parameter map.
 *
 * Separate from `upgradeParameters` because it needs the whole vehicle's
 * serial configuration, not just the file being upgraded — the same `SR2_`
 * becomes a different `MAV` depending on what the other ports are doing.
 */
export function upgradeStreamRates<T>(
  parameters: ReadonlyMap<string, T>,
  renames: ReadonlyMap<string, string>
): UpgradeResult<T> {
  if (renames.size === 0) return { parameters, renamed: [] }

  const out = new Map(parameters)
  const moved: ParameterRename[] = []
  for (const [name, entry] of parameters) {
    const match = /^(SR\d+_)(.+)$/.exec(name)
    const prefix = match?.[1]
    const to = prefix ? renames.get(prefix) : undefined
    if (!match || !to) continue
    const renamedTo = `${to}${match[2]}`
    // Already upgraded: the current value wins over the stale one beside it,
    // exactly as the static renames behave.
    if (out.has(renamedTo)) {
      out.delete(name)
      continue
    }
    out.delete(name)
    out.set(renamedTo, entry)
    moved.push({ from: name, to: renamedTo, value: Number.NaN })
  }
  return { parameters: out, renamed: moved }
}
