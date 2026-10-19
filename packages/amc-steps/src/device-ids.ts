/**
 * Which sensors a flight controller has, read off its DEVID parameters.
 *
 * AMC's device table (data_model_fc_diagnostics.device_rows, over
 * decode_devid.decode_device_id). ArduPilot packs four things into the 24 bits
 * of every COMPASS_DEV_ID, INS_ACC_ID, BAROn_DEVID and ARSPD_DEVID: the bus
 * type, the bus number, the address on it, and a driver byte. Decoded, that is
 * the answer to "which compass is the one in the GPS module", which the
 * component declaration otherwise has the operator guess.
 *
 * The driver names come from AMC's devid.json, synced into steps/ like the
 * rest of its data: generated from ArduPilot's own enums, so not something to
 * transcribe here and let drift.
 */

export type DeviceCategory = 'compass' | 'imu' | 'baro' | 'airspeed' | 'mavlink'

export interface DevIdTables {
  readonly bus_types: readonly { readonly value: number; readonly name: string }[]
  readonly device_types: Readonly<Record<string, readonly { readonly value: number; readonly name: string }[]>>
}

export interface DecodedDeviceId {
  readonly busTypeValue: number
  readonly busTypeName: string
  readonly bus: number
  readonly address: number
  readonly devtype: number
  /** DroneCAN IDs carry a node, not a driver, in the devtype byte. */
  readonly isDroneCan: boolean
}

export interface DeviceRow {
  /** COMPASS1, INS_ACC2, BARO1, ... */
  readonly name: string
  readonly busType: string
  readonly bus: number
  readonly address: number
  /** The driver, or DRONECAN. */
  readonly devtype: string
  /** A compass's configured priority, 1 first; undefined for anything else. */
  readonly priority: number | undefined
  /** Where the row came from: `COMPASS_DEV_ID: 97539`. */
  readonly source: string
}

const MAX_DEVICE_ID = 0x00ffffff

/** AMC's decode_device_id. Undefined for an ID outside the 24-bit format. */
export function decodeDeviceId(deviceId: number, tables: DevIdTables): DecodedDeviceId | undefined {
  if (deviceId < 0 || deviceId > MAX_DEVICE_ID) return undefined
  const busType = deviceId & 0x07
  return {
    busTypeValue: busType,
    busTypeName: tables.bus_types.find((entry) => entry.value === busType)?.name ?? 'UNKNOWN',
    bus: (deviceId >> 3) & 0x1f,
    address: (deviceId >> 8) & 0xff,
    devtype: (deviceId >> 16) & 0xff,
    isDroneCan: busType === 3
  }
}

/** AMC's get_device_type_name. */
export function deviceTypeName(devtype: number, category: DeviceCategory, tables: DevIdTables): string {
  return tables.device_types[category]?.find((entry) => entry.value === devtype)?.name ?? 'UNKNOWN'
}

function categoryOf(parameter: string): DeviceCategory | undefined {
  if (parameter.startsWith('COMPASS_')) return 'compass'
  if (parameter.startsWith('BARO')) return 'baro'
  if (parameter.startsWith('INS') && (parameter.includes('_ACC') || parameter.includes('_GYR'))) return 'imu'
  if (parameter.startsWith('ARSPD') || parameter.startsWith('AIRSPEED')) return 'airspeed'
  return undefined
}

/**
 * Python's int() on a parameter value: truncation toward zero, and undefined
 * where Python would raise (NaN, infinity).
 */
function pythonInt(value: number): number | undefined {
  return Number.isFinite(value) ? Math.trunc(value) : undefined
}

/**
 * Compass device ID to its configured priority, from COMPASS_PRIOn_ID.
 *
 * The priority is n, not the compass's instance number -- the point of the
 * column, since the instance order and the order ArduPilot trusts them in
 * are not the same thing.
 */
function compassPriorities(parameters: Readonly<Record<string, number>>): Map<number, number> {
  const priorities = new Map<number, number>()
  for (const [parameter, raw] of Object.entries(parameters)) {
    const match = /^COMPASS_PRIO([1-9]\d*)_ID$/.exec(parameter)
    if (!match) continue
    const deviceId = pythonInt(raw)
    // Exact integers only, and inside the 24-bit format.
    if (deviceId === undefined || raw !== deviceId || !(deviceId > 0 && deviceId <= MAX_DEVICE_ID)) continue
    const priority = Number(match[1])
    priorities.set(deviceId, Math.min(priority, priorities.get(deviceId) ?? priority))
  }
  return priorities
}

/** AMC's device_rows: every present sensor, decoded, sorted by name. */
export function deviceRows(parameters: Readonly<Record<string, number>>, tables: DevIdTables): readonly DeviceRow[] {
  const rows: DeviceRow[] = []
  const priorities = compassPriorities(parameters)
  for (const [parameter, raw] of Object.entries(parameters)) {
    const category = categoryOf(parameter)
    if (
      category === undefined ||
      !(parameter.endsWith('_DEVID') || parameter.includes('_DEV_ID') || (category === 'imu' && parameter.endsWith('_ID')))
    ) {
      continue
    }
    const deviceId = pythonInt(raw)
    if (deviceId === undefined || deviceId <= 0) continue
    const decoded = decodeDeviceId(deviceId, tables)
    if (!decoded) continue

    let name = parameter.endsWith('_DEVID')
      ? parameter.slice(0, -'_DEVID'.length)
      : parameter.replace(/_ID(\d*)$/, '$1')
    const compassInstance = /^COMPASS_DEV_ID(\d*)$/.exec(parameter)
    if (compassInstance) name = `COMPASS${compassInstance[1] || '1'}`

    const devtype = (decoded.isDroneCan ? 'DRONECAN' : deviceTypeName(decoded.devtype, category, tables)).replace(
      /^(?:(?:DEVTYPE_?|INS_|BARO_|ACC_|GYR_))+/i,
      ''
    )
    rows.push({
      name,
      busType: decoded.busTypeName,
      bus: decoded.bus,
      address: decoded.address,
      devtype,
      priority: category === 'compass' ? priorities.get(deviceId) : undefined,
      source: `${parameter}: ${deviceId}`
    })
  }
  // Python's sorted() is stable on the name alone, as is Array.prototype.sort.
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
