/**
 * The shape of AMC's connection lookup tables.
 *
 * The data is extracted from AMC's own source by
 * scripts/extract-connection-tables.py rather than transcribed — several
 * hundred entries mapping parameter values to hardware, where a typo would be
 * invisible until a vehicle imported the wrong thing.
 *
 * Typed loosely on purpose: this describes a file upstream owns, and a table
 * that gains a field should not stop it loading.
 */

export interface ConnectionEntry {
  readonly type: readonly string[]
  readonly protocol: string
  readonly component?: string | null
}

export interface ConnectionTables {
  readonly SERIAL_PORTS: readonly string[]
  readonly CAN_PORTS: readonly string[]
  readonly I2C_PORTS: readonly string[]
  readonly ANALOG_PORTS: readonly string[]
  readonly OTHER_PORTS: readonly string[]
  readonly RC_PORTS: readonly string[]
  readonly PWM_OUT_PORTS: readonly string[]
  readonly SERVO_FUNCTION_ESC_CONTROL: readonly number[]
  readonly ESC_TELEMETRY_ONLY_PROTOCOLS: readonly string[]
  readonly SERIAL_PROTOCOLS_DICT: Readonly<Record<string, ConnectionEntry>>
  readonly BATT_MONITOR_CONNECTION: Readonly<Record<string, ConnectionEntry>>
  readonly GNSS_RECEIVER_CONNECTION: Readonly<Record<string, ConnectionEntry>>
  readonly RC_PROTOCOLS_DICT: Readonly<Record<string, ConnectionEntry>>
  /** Keyed by firmware, then by MOT_PWM_TYPE value. */
  readonly ESC_CONNECTION_DICT: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** Keyed by firmware, then by FRAME_CLASS value: `{ "1": "Quad" }`. */
  readonly FRAME_CLASS_DICT: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly BATTERY_CELL_VOLTAGE_TYPES: readonly string[]
  readonly BATTERY_DEFAULT_CHEMISTRY: string
  /** Per chemistry: `absolute_min`/`absolute_max` and a volt for each type. */
  readonly _recommended_battery_cell_voltages: Readonly<
    Record<string, Readonly<Record<string, number | null>>>
  >
}
