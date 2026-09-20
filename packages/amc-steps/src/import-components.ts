/**
 * Deriving the vehicle's declaration from its own parameters.
 *
 * The declaration form asks two dozen questions the operator must answer
 * before most of the sequence can be evaluated — what the ESC is, how the GNSS
 * is wired, how many cells the battery has. A configured flight controller has
 * already answered most of them: `SERIAL3_PROTOCOL` says a GPS is on serial 3,
 * `BATT_MONITOR` says how the battery is measured, `MOT_BAT_VOLT_MAX` divided
 * by a per-cell voltage gives the cell count.
 *
 * So this reads the answers off the vehicle instead of asking for them. It is
 * a port of AMC's `ComponentDataModelImport.process_fc_parameters`, and the
 * lookup tables it needs are extracted from AMC's own source rather than
 * transcribed (scripts/extract-connection-tables.py) — several hundred entries
 * where a typo would be invisible.
 *
 * Everything here is a SUGGESTION. A parameter says how the vehicle is
 * configured, which is not the same as how it is wired: an operator who set
 * BATT_MONITOR wrong has a wrong declaration, and the sequence would then
 * confidently compute from it. The caller decides what to do with the result,
 * and the UI offers rather than applies.
 */

import type { ConnectionTables } from './connection-tables.js'

/** One derived field: where it goes, what it says, and what said so. */
export interface DerivedComponent {
  /** `['Battery', 'Specifications', 'Number of cells']` */
  readonly path: readonly string[]
  readonly value: string
  /** The parameters this was read from, for an operator who disagrees with it. */
  readonly from: readonly string[]
}

export interface ImportResult {
  readonly derived: readonly DerivedComponent[]
  /**
   * What could not be derived and why.
   *
   * Reported rather than dropped: "RC_PROTOCOLS has several protocols enabled,
   * so which one is in use cannot be told" is a useful thing for an operator to
   * read, and silently leaving the field blank is not.
   */
  readonly undetermined: readonly string[]
}

type Params = Readonly<Record<string, number>>

/** Vehicle kinds as the ESC table keys them. */
export type FirmwareKind = 'ArduCopter' | 'ArduPlane' | 'Rover' | 'Heli'

export interface ImportOptions {
  /** `MOT_PWM_TYPE`'s documented values, preferred over the built-in table. */
  readonly pwmTypeValues?: Readonly<Record<string, string>>
  /**
   * What the operator has already declared, keyed `'Battery/Specifications/Chemistry'`.
   *
   * Not decoration. Several chemistries share a volt-per-cell figure, so the
   * voltages cannot always tell them apart, and the tie-break is arbitrary
   * enough to land on NiCd for a 14S lithium pack (58.8 / 1.4 divides exactly,
   * and 58.8 / 4.2 does not, by one part in 10^15). AMC avoids this by keeping
   * what the operator already said unless the parameters clearly contradict
   * it, and so does this.
   */
  readonly current?: Readonly<Record<string, string>>
}

export function importComponentsFromParameters(
  parameters: Params,
  tables: ConnectionTables,
  firmware: FirmwareKind = 'ArduCopter',
  options: ImportOptions = {}
): ImportResult {
  const out = new Map<string, DerivedComponent>()
  const undetermined: string[] = []
  const set = (path: readonly string[], value: string | number, from: readonly string[]): void => {
    out.set(path.join('/'), { path, value: String(value), from })
  }
  const get = (path: readonly string[]): string | undefined => out.get(path.join('/'))?.value

  frameClass(parameters, tables, firmware, options, set)
  gnss(parameters, tables, set, undetermined)
  const escIsSerial = serialComponents(parameters, tables, options, set, get, undetermined)
  if (!escIsSerial) escFromPwm(parameters, tables, firmware, options, set, get)
  battery(parameters, tables, options, set, undetermined)
  motorPoles(parameters, tables, firmware, set)

  return { derived: [...out.values()], undetermined }
}

type Setter = (path: readonly string[], value: string | number, from: readonly string[]) => void
type Getter = (path: readonly string[]) => string | undefined

const asInt = (value: number | undefined): number | undefined =>
  value === undefined || !Number.isFinite(value) ? undefined : Math.trunc(value)

function frameClass(
  parameters: Params,
  tables: ConnectionTables,
  firmware: FirmwareKind,
  options: ImportOptions,
  set: Setter
): void {
  void options
  // A quadplane's frame class lives under Q_FRAME_CLASS; everything else uses
  // FRAME_CLASS.
  const name = 'Q_FRAME_CLASS' in parameters ? 'Q_FRAME_CLASS' : 'FRAME_CLASS'
  const value = asInt(parameters[name])
  if (value === undefined) return
  // Falls back to Copter the way AMC does: a vehicle whose firmware has no
  // table of its own still has frame classes numbered the same way.
  const label = (tables.FRAME_CLASS_DICT[firmware] ?? tables.FRAME_CLASS_DICT.ArduCopter)?.[String(value)]
  if (label) set(['Frame', 'Specifications', 'Frame class'], label, [name])
}

function gnss(parameters: Params, tables: ConnectionTables, set: Setter, undetermined: string[]): void {
  // GPS_TYPE became GPS1_TYPE in ArduPilot 4.6; a vehicle carries one or the
  // other and both mean the same thing.
  const name = 'GPS1_TYPE' in parameters ? 'GPS1_TYPE' : 'GPS_TYPE'
  // Present, not merely defaulted. AMC treats an absent GPS_TYPE as 0 and so
  // declares "no GNSS"; but a vehicle that never reported the parameter is one
  // we have not read, not one without a receiver, and writing "None" into the
  // operator's declaration on that basis is a guess wearing a fact's clothes.
  const value = asInt(parameters[name])
  if (value === undefined) return
  const entry = tables.GNSS_RECEIVER_CONNECTION[String(value)]
  const path = ['GNSS Receiver', 'FC Connection'] as const

  if (!entry) {
    undetermined.push(`${name} is ${value}, which is not a GNSS connection this version knows`)
    return
  }
  const types = entry.type
  const protocol = String(entry.protocol)

  if (types.length === 1 && types[0] === 'None') {
    set([...path, 'Type'], 'None', [name])
    set([...path, 'Protocol'], 'None', [name])
    return
  }
  if (types.some((t) => tables.SERIAL_PORTS.includes(t))) {
    // WHICH serial port is decided by the SERIAL*_PROTOCOL scan below; all
    // this parameter settles is the protocol spoken over it.
    set([...path, 'Protocol'], protocol, [name])
    return
  }
  if (types.some((t) => tables.CAN_PORTS.includes(t))) {
    // A DroneCAN GPS is on whichever bus is both driven and speaking DroneCAN.
    const bus =
      parameters.CAN_D1_PROTOCOL === 1 && parameters.CAN_P1_DRIVER === 1
        ? 'CAN1'
        : parameters.CAN_D2_PROTOCOL === 1 && parameters.CAN_P2_DRIVER === 1
          ? 'CAN2'
          : undefined
    if (bus === undefined) {
      // The parameters contradict themselves: the receiver is declared as a
      // CAN one and no bus is set up to carry it. AMC writes "None" for the
      // port and keeps the protocol, which leaves a declaration that cannot be
      // true -- DroneCAN over SERIAL3, once the serial scan fills the blank in.
      // Neither half is claimed here, because the sequence would go on to
      // compute from whichever one it read.
      undetermined.push(
        `${name} says the GNSS speaks ${protocol}, but no CAN bus is configured for it (CAN_D1_PROTOCOL/CAN_P1_DRIVER) — neither its port nor its protocol could be read`
      )
      return
    }
    set([...path, 'Type'], bus, [name, `CAN_D${bus.slice(-1)}_PROTOCOL`, `CAN_P${bus.slice(-1)}_DRIVER`])
    set([...path, 'Protocol'], protocol, [name])
    return
  }
  undetermined.push(`${name} is ${value}, whose connection type is not one this reads`)
}

/**
 * Walk SERIAL*_PROTOCOL and attribute each port to the component using it.
 *
 * Returns whether the ESC is driven over a serial protocol, because that
 * decides whether MOT_PWM_TYPE has anything to say about it.
 */
function serialComponents(
  parameters: Params,
  tables: ConnectionTables,
  options: ImportOptions,
  set: Setter,
  get: Getter,
  undetermined: string[]
): boolean {
  // Which ports are configured for each component, before choosing between
  // them. A vehicle commonly has two ports set to GPS or to MAVLink, and the
  // parameters do not say which one has the hardware on it -- so the choice
  // has to be made knowingly rather than by whichever the loop reached first.
  const candidates = new Map<string, string[]>()
  for (const serial of tables.SERIAL_PORTS) {
    const value = asInt(parameters[`${serial}_PROTOCOL`])
    if (value === undefined || value === 0) continue
    const component = tables.SERIAL_PROTOCOLS_DICT[String(value)]?.component
    if (!component) continue
    const list = candidates.get(component) ?? []
    list.push(serial)
    candidates.set(component, list)
  }

  /**
   * The port to attribute a component to: the operator's, when the parameters
   * corroborate it, otherwise the lowest-numbered. Their answer beats ours
   * because they can see the wiring, and ours is only a tie-break.
   */
  const chooseFor = (component: string, path: readonly string[]): string | undefined => {
    const ports = candidates.get(component)
    if (!ports || ports.length === 0) return undefined
    const declared = options.current?.[[...path, 'Type'].join('/')]
    if (declared !== undefined && ports.includes(declared)) return declared
    if (ports.length > 1) {
      const listed = ports.length === 2 ? ports.join(' and ') : `${ports.slice(0, -1).join(', ')} and ${ports.at(-1)}`
      undetermined.push(`${listed} are configured for ${component}; ${ports[0]} is assumed`)
    }
    return ports[0]
  }

  const chosen = new Map<string, string | undefined>([
    ['RC Receiver', chooseFor('RC Receiver', ['RC Receiver', 'FC Connection'])],
    ['Telemetry', chooseFor('Telemetry', ['Telemetry', 'FC Connection'])],
    ['GNSS Receiver', chooseFor('GNSS Receiver', ['GNSS Receiver', 'FC Connection'])]
  ])

  rcProtocols(parameters, tables, options, set, get, undetermined)

  let escTaken = false
  let escTelemetryTaken = false

  for (const serial of tables.SERIAL_PORTS) {
    const value = asInt(parameters[`${serial}_PROTOCOL`])
    if (value === undefined || value === 0) continue
    const entry = tables.SERIAL_PROTOCOLS_DICT[String(value)]
    if (!entry?.component) continue
    const protocol = String(entry.protocol)
    const from = [`${serial}_PROTOCOL`]

    if (entry.component === 'RC Receiver' && chosen.get('RC Receiver') === serial) {
      // Protocol comes from RC_PROTOCOLS, not from here.
      set(['RC Receiver', 'FC Connection', 'Type'], serial, from)
    } else if (entry.component === 'Telemetry' && chosen.get('Telemetry') === serial) {
      set(['Telemetry', 'FC Connection', 'Type'], serial, from)
      set(['Telemetry', 'FC Connection', 'Protocol'], protocol, from)
    } else if (entry.component === 'GNSS Receiver' && chosen.get('GNSS Receiver') === serial) {
      // Order matters: the CAN case above already decided, and a serial port
      // must not overwrite it.
      if (!tables.CAN_PORTS.includes(get(['GNSS Receiver', 'FC Connection', 'Type']) ?? '')) {
        set(['GNSS Receiver', 'FC Connection', 'Type'], serial, from)
      }
    } else if (entry.component === 'ESC') {
      if (tables.ESC_TELEMETRY_ONLY_PROTOCOLS.includes(protocol)) {
        // Telemetry only — the FC still drives the ESC over PWM or DShot, so
        // MOT_PWM_TYPE still has the last word on the control connection.
        if (!escTelemetryTaken) {
          set(['ESC', 'ESC->FC Telemetry', 'Type'], serial, from)
          set(['ESC', 'ESC->FC Telemetry', 'Protocol'], protocol, from)
          escTelemetryTaken = true
        }
      } else if (!escTaken) {
        // A serial ESC protocol carries both directions on the one port.
        set(['ESC', 'FC->ESC Connection', 'Type'], serial, from)
        set(['ESC', 'FC->ESC Connection', 'Protocol'], protocol, from)
        set(['ESC', 'ESC->FC Telemetry', 'Type'], serial, from)
        set(['ESC', 'ESC->FC Telemetry', 'Protocol'], protocol, from)
        escTaken = true
      }
    }
  }
  return escTaken
}

function rcProtocols(
  parameters: Params,
  tables: ConnectionTables,
  options: ImportOptions,
  set: Setter,
  get: Getter,
  undetermined: string[]
): void {
  const mask = asInt(parameters.RC_PROTOCOLS)
  if (mask === undefined || mask <= 0) return

  // "Something is on the RC input" is the weakest thing this derives: a
  // receiver on a serial port is invisible unless that port is set to RCIN,
  // and several templates have one anyway. So it fills a blank and never
  // argues with an operator who has already answered.
  const declared = options.current?.['RC Receiver/FC Connection/Type']
  if (!get(['RC Receiver', 'FC Connection', 'Type']) && !declared) {
    set(['RC Receiver', 'FC Connection', 'Type'], 'RCin/SBUS', ['RC_PROTOCOLS'])
  }

  // A bitmask with one bit set names one protocol. With several, the vehicle
  // will accept any of them and which is actually in use cannot be told from
  // parameters — worth saying rather than guessing.
  if ((mask & (mask - 1)) !== 0) {
    undetermined.push(
      `RC_PROTOCOLS has ${countBits(mask)} protocols enabled, so which one the receiver uses cannot be told`
    )
    return
  }
  const entry = tables.RC_PROTOCOLS_DICT[String(mask)]
  if (entry) set(['RC Receiver', 'FC Connection', 'Protocol'], String(entry.protocol), ['RC_PROTOCOLS'])
}

function countBits(value: number): number {
  let count = 0
  for (let v = value; v !== 0; v >>>= 1) count += v & 1
  return count
}

function escFromPwm(
  parameters: Params,
  tables: ConnectionTables,
  firmware: FirmwareKind,
  options: ImportOptions,
  set: Setter,
  get: Getter
): void {
  // Same reasoning as the GNSS: absent is unknown, not zero.
  const pwmType = asInt(parameters.MOT_PWM_TYPE)
  if (pwmType === undefined) return

  // Outputs 9..14 carrying a motor function mean the ESCs are on the AIO
  // header rather than the main output rail.
  const aio = [9, 10, 11, 12, 13, 14].some((i) =>
    tables.SERVO_FUNCTION_ESC_CONTROL.includes(asInt(parameters[`SERVO${i}_FUNCTION`]) ?? -1)
  )
  set(['ESC', 'FC->ESC Connection', 'Type'], aio ? 'AIO' : 'Main Out', ['MOT_PWM_TYPE'])

  // The firmware's own documentation is preferred; the table is the fallback
  // for a build whose metadata we do not have.
  const documented = options.pwmTypeValues?.[String(pwmType)]
  const tabled = tables.ESC_CONNECTION_DICT[firmware]?.[String(pwmType)] as { protocol?: string } | undefined
  const protocol = documented ?? tabled?.protocol
  if (protocol) set(['ESC', 'FC->ESC Connection', 'Protocol'], protocol, ['MOT_PWM_TYPE'])

  // DShot carries telemetry back along the same wire — but only if the serial
  // scan did not already find a dedicated telemetry port, which outranks it.
  const telemetryType = get(['ESC', 'ESC->FC Telemetry', 'Type']) ?? ''
  const dedicated =
    tables.SERIAL_PORTS.includes(telemetryType) || tables.CAN_PORTS.includes(telemetryType)
  if (protocol?.startsWith('DShot')) {
    if (!dedicated) {
      set(['ESC', 'ESC->FC Telemetry', 'Type'], aio ? 'AIO' : 'Main Out', ['MOT_PWM_TYPE'])
      set(['ESC', 'ESC->FC Telemetry', 'Protocol'], 'BDShotOnly', ['MOT_PWM_TYPE'])
    }
  } else if (!dedicated) {
    set(['ESC', 'ESC->FC Telemetry', 'Type'], 'None', ['MOT_PWM_TYPE'])
    set(['ESC', 'ESC->FC Telemetry', 'Protocol'], 'None', ['MOT_PWM_TYPE'])
  }
}

function motorPoles(
  parameters: Params,
  tables: ConnectionTables,
  firmware: FirmwareKind,
  set: Setter
): void {
  // Two ways an ESC reports pole count, and WHICH ONE APPLIES depends on how
  // the ESC is driven. SERVO_BLH_POLES is the BLHeli passthrough's idea of the
  // motor, and it is only the motor's when the ESC is actually driven by
  // DShot; FETtec keeps its own count. Reading BLH unconditionally put a
  // helicopter's 42 poles at 14, which is the number left over in a parameter
  // nothing was using.
  const pwmType = asInt(parameters.MOT_PWM_TYPE)
  const entry = tables.ESC_CONNECTION_DICT[firmware]?.[String(pwmType)] as
    | { type?: readonly string[]; ESC_to_FC?: Readonly<Record<string, unknown>> }
    | undefined
  // DShot is exactly the case where the ESC can answer back down the same
  // wire, which the table records as a "same_as_FC_to_ESC" telemetry option.
  const isDshot =
    entry?.ESC_to_FC !== undefined &&
    'same_as_FC_to_ESC' in entry.ESC_to_FC &&
    Array.isArray(entry.type) &&
    entry.type.length === tables.PWM_OUT_PORTS.length &&
    entry.type.every((t) => tables.PWM_OUT_PORTS.includes(t))

  if (isDshot) {
    const poles = asInt(parameters.SERVO_BLH_POLES)
    if (poles !== undefined && poles > 0) {
      set(['Motors', 'Specifications', 'Poles'], poles, ['MOT_PWM_TYPE', 'SERVO_BLH_POLES'])
    }
    return
  }
  if (parameters.SERVO_FTW_MASK) {
    const poles = asInt(parameters.SERVO_FTW_POLES)
    if (poles !== undefined && poles > 0) {
      set(['Motors', 'Specifications', 'Poles'], poles, ['SERVO_FTW_MASK', 'SERVO_FTW_POLES'])
    }
  }
}

function battery(
  parameters: Params,
  tables: ConnectionTables,
  options: ImportOptions,
  set: Setter,
  undetermined: string[]
): void {
  batteryMonitor(parameters, tables, set, undetermined)

  const declared = options.current?.['Battery/Specifications/Chemistry']
  const detected = detectChemistry(parameters, tables, declared)
  const chemistry = detected ?? declared ?? tables.BATTERY_DEFAULT_CHEMISTRY
  const cells = estimateCellCount(parameters, tables, chemistry)

  const capacity = asInt(parameters.BATT_CAPACITY)
  if (capacity !== undefined && capacity > 0) {
    set(['Battery', 'Specifications', 'Capacity mAh'], capacity, ['BATT_CAPACITY'])
  }

  if (cells === undefined) {
    undetermined.push(
      'The battery cell count could not be estimated, so the per-cell voltages were left alone'
    )
    return
  }
  // Only stated when the parameters actually said so. Echoing back the
  // operator's own declaration as though the vehicle had told us is the kind
  // of false confirmation that makes a derived field worth less than a blank.
  if (detected !== undefined) {
    set(['Battery', 'Specifications', 'Chemistry'], chemistry, VOLTAGE_PARAMS.map(([name]) => name))
  }
  set(['Battery', 'Specifications', 'Number of cells'], cells, ['MOT_BAT_VOLT_MAX'])

  const limits = tables._recommended_battery_cell_voltages[chemistry]
  for (const [name, spec] of VOLTAGE_PARAMS) {
    const total = parameters[name]
    if (total === undefined || total <= 0) continue
    // Rounded to four places the way AMC does, so a declaration written here
    // and one written there are the same file.
    const perCell = Math.round((total / cells) * 10000) / 10000
    const min = limits?.absolute_min ?? -Infinity
    const max = limits?.absolute_max ?? Infinity
    if (perCell < min || perCell > max) {
      undetermined.push(
        `${name} works out at ${perCell} V per cell, outside what ${chemistry} allows (${min}–${max} V)`
      )
      continue
    }
    set(['Battery', 'Specifications', spec], perCell, [name, 'MOT_BAT_VOLT_MAX'])
  }
}

/** In the priority order AMC uses, most reliable first. */
const VOLTAGE_PARAMS: readonly (readonly [string, string])[] = [
  ['MOT_BAT_VOLT_MAX', 'Volt per cell max'],
  ['BATT_LOW_VOLT', 'Volt per cell low'],
  ['BATT_CRT_VOLT', 'Volt per cell crit'],
  ['BATT_ARM_VOLT', 'Volt per cell arm'],
  ['MOT_BAT_VOLT_MIN', 'Volt per cell min']
]

function batteryMonitor(
  parameters: Params,
  tables: ConnectionTables,
  set: Setter,
  undetermined: string[]
): void {
  const monitor = asInt(parameters.BATT_MONITOR)
  if (monitor === undefined) return
  const entry = tables.BATT_MONITOR_CONNECTION[String(monitor)]
  if (!entry) {
    undetermined.push(`BATT_MONITOR is ${monitor}, which is not a monitor this version knows`)
    return
  }
  const types = entry.type
  let type = types[0] as string
  const from = ['BATT_MONITOR']
  // An I2C monitor could be on any of the buses, and BATT_I2C_BUS says which.
  if (types.every((t) => tables.I2C_PORTS.includes(t))) {
    const bus = asInt(parameters.BATT_I2C_BUS)
    if (bus !== undefined && bus >= 0 && bus < types.length) {
      type = types[bus] as string
      from.push('BATT_I2C_BUS')
    }
  }
  set(['Battery Monitor', 'FC Connection', 'Type'], type, from)
  set(['Battery Monitor', 'FC Connection', 'Protocol'], String(entry.protocol), ['BATT_MONITOR'])
}

/**
 * Which chemistry makes the configured voltages work out to a whole number of
 * cells.
 *
 * A 25.2 V maximum is six LiPo cells at 4.2 V exactly, and nothing else fits
 * as cleanly — so the voltages identify the chemistry. Only a clean fit
 * counts: AMC's threshold is 0.03 of a cell, and anything looser would be
 * guessing.
 */
function detectChemistry(
  parameters: Params,
  tables: ConnectionTables,
  declared: string | undefined
): string | undefined {
  for (const [name, spec] of VOLTAGE_PARAMS) {
    const total = parameters[name]
    if (total === undefined || total <= 0) continue

    // What the operator already said comes first, and a chemistry that fits
    // the voltages at all is left alone. The threshold is deliberately loose
    // (AMC's 0.4 of a cell): the question is not "is this the best fit" but
    // "is the operator clearly wrong", and only the second is worth overriding.
    if (declared !== undefined) {
      const perCell = tables._recommended_battery_cell_voltages[declared]?.[spec]
      if (perCell !== null && perCell !== undefined && perCell > 0) {
        const cells = total / perCell
        if (Math.abs(cells - Math.round(cells)) < 0.4) return undefined
      }
    }

    let best: string | undefined
    let bestScore = Infinity
    for (const [chemistry, voltages] of Object.entries(tables._recommended_battery_cell_voltages)) {
      const perCell = voltages[spec]
      if (perCell === null || perCell === undefined || perCell <= 0) continue
      const cells = total / perCell
      const score = Math.abs(cells - Math.round(cells))
      if (score < bestScore) {
        bestScore = score
        best = chemistry
      }
    }
    if (best !== undefined && bestScore < 0.03) return best
  }
  return undefined
}

function estimateCellCount(
  parameters: Params,
  tables: ConnectionTables,
  chemistry: string
): number | undefined {
  const voltages = tables._recommended_battery_cell_voltages[chemistry]
  if (!voltages) return undefined
  for (const [name, spec] of VOLTAGE_PARAMS) {
    const total = parameters[name]
    const perCell = voltages[spec]
    if (total === undefined || total <= 0 || perCell === null || perCell === undefined || perCell <= 0) continue
    const cells = Math.round(total / perCell)
    // A pack outside this is not a pack; it is a misread parameter.
    if (cells >= 1 && cells <= 50) return cells
  }
  return undefined
}
