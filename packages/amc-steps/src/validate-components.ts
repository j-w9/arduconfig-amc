/**
 * Checking the declaration before anything is computed from it.
 *
 * The sequence derives everything from what the operator declares, so a
 * declaration that is merely *plausible* produces a configuration directory
 * that is confidently wrong. Cell voltages entered out of order drive the
 * battery failsafes to values that trip on a full pack; two components claiming
 * one serial port means whichever step runs last silently wins.
 *
 * AMC checks all of this before it will write anything
 * (`ComponentDataModelValidation.validate_all_data`), and the checks are worth
 * having here for the same reason they are worth having there -- they catch
 * the mistakes at the point they can still be explained, rather than as a
 * vehicle that behaves oddly a month later.
 */

import type { ConnectionTables } from './connection-tables.js'

/** Where a value sits in the declaration, as AMC addresses it. */
export type ComponentPath = readonly string[]

export interface ValidationError {
  /** The path, joined with `>` the way AMC prints it. */
  readonly where: string
  readonly path: ComponentPath
  readonly message: string
  /**
   * What AMC would put in the field instead, when it has an answer.
   *
   * AMC does not merely complain: a value outside a limit is replaced by the
   * limit, and an unparseable voltage by the recommended one. Offered here
   * rather than applied, because a caller that silently rewrote what someone
   * typed would be worse than one that says what it would have written.
   */
  readonly suggestion?: number
}

/**
 * The numeric fields AMC bounds, with the type it reads them as.
 *
 * Transcribed from `ComponentDataModelValidation.VALIDATION_RULES`; the
 * `integer` flag is AMC's `int` vs `float`, which matters because `int("2.5")`
 * raises in Python rather than truncating.
 */
export const ENTRY_LIMITS: readonly {
  readonly path: ComponentPath
  readonly integer: boolean
  readonly min: number
  readonly max: number
  readonly name: string
}[] = [
  { path: ['Frame', 'Specifications', 'TOW min Kg'], integer: false, min: 0.01, max: 600, name: 'Takeoff Weight' },
  { path: ['Frame', 'Specifications', 'TOW max Kg'], integer: false, min: 0.01, max: 600, name: 'Takeoff Weight' },
  { path: ['Battery', 'Specifications', 'Number of cells'], integer: true, min: 1, max: 50, name: 'Nr of cells' },
  { path: ['Battery', 'Specifications', 'Capacity mAh'], integer: true, min: 100, max: 1000000, name: 'mAh capacity' },
  { path: ['Motors', 'Specifications', 'Poles'], integer: true, min: 2, max: 100, name: 'Motor Poles' },
  { path: ['Propellers', 'Specifications', 'Diameter_inches'], integer: false, min: 0.3, max: 400, name: 'Propeller Diameter' }
]

/** The gap AMC leaves when it corrects one value away from another. */
const DELTA = 0.01

/**
 * Ports that several components may legitimately share.
 *
 * CAN and I2C are buses -- addressing is what separates devices on them, not
 * the port -- so two components naming CAN1 is a description of a bus, not a
 * conflict. "None" is the absence of a connection.
 */
const SHARED_PORTS: ReadonlySet<string> = new Set([
  'CAN1', 'CAN2', 'I2C1', 'I2C2', 'I2C3', 'I2C4', 'None'
])

const ESC_CONNECTION_SECTIONS: ReadonlySet<string> = new Set(['FC->ESC Connection', 'ESC->FC Telemetry'])

const CELL_VOLTAGE_SECTION = ['Battery', 'Specifications'] as const

function joined(path: ComponentPath): string {
  return path.join('>')
}

/**
 * A number the way Python prints a float.
 *
 * These messages are compared against AMC's own output, and Python's `str` of
 * a float keeps the point: a LiPo's floor reads "3.0", not "3". Only used
 * where AMC has run the value through `float()` -- the entry limits print
 * their table literal, which is an `int` for some rules and a `float` for
 * others, and JavaScript already renders those the same way.
 */
function pyFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`
}

/** Python's `float()`: rejects the empty string and anything non-numeric. */
function asFloat(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Python's `int()`: "2.5" raises rather than truncating, so it is not a value. */
function asInt(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined
  return Number(trimmed)
}

/** AMC's `validate_against_another_value`. */
function against(
  value: number,
  limit: string | number | undefined,
  limitName: string,
  above: boolean
): { message: string; suggestion?: number } | undefined {
  // The one deliberate divergence from AMC.
  //
  // AMC always has a value here, because it opens a template before it
  // validates anything; a missing one reaches `validate_against_another_value`
  // as an empty dict and is reported as "not a float nor string". This form
  // starts empty, so that message would appear against every neighbour of
  // every field nobody has answered yet -- a blank field is unanswered, not
  // wrong, and there is nothing to compare it to either way.
  if (limit === undefined || limit === '') return undefined
  const bound = typeof limit === 'number' ? limit : asFloat(limit)
  if (bound === undefined) return { message: `${limitName} is not convertible to float` }

  if (above && value < bound) {
    return { message: `is below the ${limitName} of ${pyFloat(bound)}`, suggestion: bound + DELTA }
  }
  if (!above && value > bound) {
    return { message: `is above the ${limitName} of ${pyFloat(bound)}`, suggestion: bound - DELTA }
  }
  return undefined
}

export interface Declaration {
  /** Read a declared value by path, as the operator currently has it. */
  get(path: ComponentPath): string | undefined
}

/** A declaration backed by a flat map keyed the way the form keys it. */
export function declarationFrom(
  values: Readonly<Record<string, string>>,
  key: (path: ComponentPath) => string = (path) => path.join('/')
): Declaration {
  return { get: (path) => values[key(path)] }
}

/** AMC's `validate_entry_limits`, without the cross-field parts. */
export function validateEntryLimit(path: ComponentPath, value: string): ValidationError | undefined {
  const rule = ENTRY_LIMITS.find((entry) => entry.path.join('/') === path.join('/'))
  if (!rule) return undefined

  const parsed = rule.integer ? asInt(value) : asFloat(value)
  if (parsed === undefined) {
    return { where: joined(path), path, message: `Invalid ${rule.integer ? 'int' : 'float'} value for ${rule.name}` }
  }
  if (parsed < rule.min || parsed > rule.max) {
    return {
      where: joined(path),
      path,
      message: `${rule.name} must be a ${rule.integer ? 'int' : 'float'} between ${rule.min} and ${rule.max}`,
      suggestion: parsed < rule.min ? rule.min : rule.max
    }
  }
  return undefined
}

/**
 * AMC's `validate_cell_voltage`.
 *
 * The ordering is deliberately not a single monotonic chain: max > arm > low,
 * and then crit and min each independently below low. AMC's own comment says
 * why -- there is no reason crit and min must be ordered against each other,
 * they only both have to be under the low threshold.
 */
export function validateCellVoltage(
  path: ComponentPath,
  value: string,
  declaration: Declaration,
  tables: ConnectionTables,
  chemistry: string
): ValidationError | undefined {
  const type = path[path.length - 1]
  if (type === undefined || !tables.BATTERY_CELL_VOLTAGE_TYPES.includes(type)) return undefined

  const limits = tables._recommended_battery_cell_voltages[chemistry]
  const at = (name: string): ValidationError => ({ where: joined(path), path, message: name })

  const voltage = asFloat(value)
  if (voltage === undefined) {
    const recommended = limits?.[type]
    return {
      ...at('Invalid value. Will be set to the recommended value.'),
      ...(typeof recommended === 'number' ? { suggestion: recommended } : {})
    }
  }

  const min = limits?.['absolute_min']
  if (typeof min === 'number' && voltage < min) {
    return { ...at(`is below the ${chemistry} minimum limit of ${pyFloat(min)}`), suggestion: min }
  }
  const max = limits?.['absolute_max']
  if (typeof max === 'number' && voltage > max) {
    return { ...at(`is above the ${chemistry} maximum limit of ${pyFloat(max)}`), suggestion: max }
  }

  const other = (name: string) => declaration.get([...CELL_VOLTAGE_SECTION, name])
  const fail = (result: ReturnType<typeof against>): ValidationError | undefined =>
    result === undefined
      ? undefined
      : { where: joined(path), path, message: result.message, ...(result.suggestion === undefined ? {} : { suggestion: result.suggestion }) }

  switch (type) {
    case 'Volt per cell max':
      return fail(against(voltage, other('Volt per cell arm'), 'Volt per cell arm', true))
    case 'Volt per cell arm':
      return (
        fail(against(voltage, other('Volt per cell max'), 'Volt per cell max', false)) ??
        // Arming below the low threshold would trip the failsafe the moment
        // the vehicle armed, which is why AMC checks both sides of this one.
        fail(against(voltage, other('Volt per cell low'), 'Volt per cell low', true))
      )
    case 'Volt per cell low':
      return (
        fail(against(voltage, other('Volt per cell arm'), 'Volt per cell arm', false)) ??
        fail(against(voltage, other('Volt per cell crit'), 'Volt per cell crit', true))
      )
    case 'Volt per cell crit':
    case 'Volt per cell min':
      return fail(against(voltage, other('Volt per cell low'), 'Volt per cell low', false))
    default:
      return undefined
  }
}

/** AMC's `_validate_motor_poles`. */
export function validateMotorPoles(path: ComponentPath, value: string): ValidationError | undefined {
  if (path.join('/') !== 'Motors/Specifications/Poles') return undefined
  const poles = asInt(value)
  if (poles === undefined) {
    return { where: joined(path), path, message: `Invalid integer value for ${joined(path)}` }
  }
  // The rotor pole count is the P of a 12N14P motor, and is always even --
  // poles come in north/south pairs.
  if (poles % 2 !== 0) {
    return { where: joined(path), path, message: `Number of magnetic rotor poles must be even for ${joined(path)}` }
  }
  return undefined
}

export interface ValidateOptions {
  /** The chemistry the voltages are judged against. */
  readonly chemistry?: string
  /** Allowed values per path, where the field is a choice rather than free text. */
  readonly choices?: (path: ComponentPath) => readonly string[] | undefined
}

/**
 * AMC's `validate_all_data`, over a whole declaration.
 *
 * Order matters and is AMC's: a value that is not among a field's choices is
 * reported and nothing further is asked of it, since every later check would
 * be reasoning about a value the field cannot hold.
 */
export function validateDeclaration(
  entries: Iterable<readonly [ComponentPath, string]>,
  declaration: Declaration,
  tables: ConnectionTables,
  options: ValidateOptions = {}
): readonly ValidationError[] {
  const chemistry =
    options.chemistry ??
    declaration.get([...CELL_VOLTAGE_SECTION, 'Chemistry']) ??
    tables.BATTERY_DEFAULT_CHEMISTRY

  const errors: ValidationError[] = []
  /** Which component claimed each port, for the duplicate check. */
  const claimed = new Map<string, string>()

  for (const [path, value] of entries) {
    const choices = options.choices?.(path)
    if (choices && choices.length > 0 && !choices.includes(value)) {
      errors.push({
        where: joined(path),
        path,
        message: `Invalid value '${value}' for ${joined(path)}. Allowed values are: ${choices.join(', ')}`
      })
      continue
    }

    const duplicate = duplicateConnection(path, value, claimed)
    if (duplicate) {
      errors.push(duplicate)
      continue
    }

    const limit = validateEntryLimit(path, value)
    if (limit) {
      errors.push(limit)
      continue
    }

    const tow = validateTakeoffWeight(path, value, declaration)
    if (tow) {
      errors.push(tow)
      continue
    }

    const voltage =
      path.length === 3 && path[0] === 'Battery' && path[1] === 'Specifications'
        ? validateCellVoltage(path, value, declaration, tables, chemistry)
        : undefined
    if (voltage) {
      errors.push(voltage)
      continue
    }

    const poles = validateMotorPoles(path, value)
    if (poles) errors.push(poles)
  }

  return errors
}

/** AMC's `_validate_tow_limits`: min below max, by at least the delta. */
function validateTakeoffWeight(
  path: ComponentPath,
  value: string,
  declaration: Declaration
): ValidationError | undefined {
  if (path[0] !== 'Frame' || path[1] !== 'Specifications') return undefined
  const isMax = path[2] === 'TOW max Kg'
  if (!isMax && path[2] !== 'TOW min Kg') return undefined

  const parsed = asFloat(value)
  if (parsed === undefined) {
    return { where: joined(path), path, message: `Takeoff Weight ${isMax ? 'max' : 'min'} must be a float` }
  }
  const other = declaration.get(['Frame', 'Specifications', isMax ? 'TOW min Kg' : 'TOW max Kg'])
  if (other === undefined || other === '') return undefined

  const result = against(parsed, other, isMax ? 'TOW min Kg' : 'TOW max Kg', isMax)
  return result === undefined
    ? undefined
    : {
        where: joined(path),
        path,
        message: result.message,
        ...(result.suggestion === undefined ? {} : { suggestion: result.suggestion })
      }
}

/**
 * Two components claiming one port.
 *
 * The exceptions are AMC's and each is a real wiring arrangement rather than a
 * concession: telemetry and an RC receiver share a port when the link carries
 * both, and ESC telemetry shares the ESC's own port because that serial line
 * is bidirectional.
 */
function duplicateConnection(
  path: ComponentPath,
  value: string,
  claimed: Map<string, string>
): ValidationError | undefined {
  if (path.length < 3 || path[2] !== 'Type') return undefined
  const section = path[1] as string
  if (section !== 'FC Connection' && !ESC_CONNECTION_SECTIONS.has(section)) return undefined

  const component = path[0] as string
  const holder = claimed.get(value)
  if (holder === undefined || SHARED_PORTS.has(value)) {
    claimed.set(value, component)
    return undefined
  }

  const bothLinks = ['Telemetry', 'RC Receiver']
  if (bothLinks.includes(component) && bothLinks.includes(holder)) return undefined
  if (component === 'ESC' && ESC_CONNECTION_SECTIONS.has(section) && holder === 'ESC') return undefined

  return {
    where: joined(path),
    path,
    message: `Duplicate FC connection type '${value}' for ${joined(path)}`
  }
}

/**
 * The voltages AMC re-seeds when the chemistry changes.
 *
 * A side effect of `set_component_value`, not a validation, but it belongs
 * beside them: without it a pack switched from LiPo to Li-ion keeps LiPo's
 * thresholds, every one of which is then outside the new chemistry's range.
 */
export function cellVoltagesFor(
  tables: ConnectionTables,
  chemistry: string
): ReadonlyMap<string, number> {
  const limits = tables._recommended_battery_cell_voltages[chemistry]
  const seeded = new Map<string, number>()
  if (!limits) return seeded
  for (const type of tables.BATTERY_CELL_VOLTAGE_TYPES) {
    const value = limits[type]
    if (typeof value === 'number') seeded.set(type, value)
  }
  return seeded
}
