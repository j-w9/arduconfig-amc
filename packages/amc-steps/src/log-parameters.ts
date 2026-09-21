/**
 * What a flight log says the parameters were, and what the firmware's own
 * defaults are.
 *
 * ArduPilot writes a `PARM` record for every parameter at startup, carrying
 * both the value in force and -- on any firmware since 4.0 -- the firmware's
 * `Default` for it. AMC reads exactly this
 * (`extract_param_defaults.extract_parameter_values`) and it answers a
 * question this tab otherwise cannot answer offline.
 *
 * The defaults matter more than they sound. A step can only capture what the
 * operator has already changed, which means knowing what "unchanged" is; this
 * tab gets that from MAVFTP's packed defaults, which needs a live vehicle and
 * is the part most likely to fail. An operator with a log has the same answer
 * sitting in a file, for a vehicle that is in pieces on the bench or not
 * theirs to plug in.
 */

/** A message as the DataFlash parser hands it over. */
type LogMessage = { readonly name: string } & Record<string, unknown>

export interface LogParameters {
  /** Every parameter's value, as the log recorded it. */
  readonly values: ReadonlyMap<string, number>
  /**
   * The firmware's own default for each parameter.
   *
   * Empty on a log from firmware that does not write the `Default` column,
   * which is the honest answer rather than falling back to the values.
   */
  readonly defaults: ReadonlyMap<string, number>
  /** The parameters whose value differs from the firmware's default. */
  readonly changed: ReadonlyMap<string, number>
}

/**
 * Read the `PARM` records out of a parsed log.
 *
 * First occurrence wins, as AMC does: parameter names are unique, and a log
 * that records one twice is recording a change made during the flight. The
 * first is the value the vehicle started with, which is what a configuration
 * is being read from.
 */
export function parametersFromLog(
  messagesByType: ReadonlyMap<string, readonly LogMessage[]>
): LogParameters {
  const values = new Map<string, number>()
  const defaults = new Map<string, number>()
  const changed = new Map<string, number>()

  for (const message of messagesByType.get('PARM') ?? []) {
    const name = message['Name']
    if (typeof name !== 'string' || name.length === 0) continue
    if (values.has(name)) continue

    const value = finite(message['Value'])
    if (value === undefined) continue
    values.set(name, value)

    const fallback = finite(message['Default'])
    if (fallback === undefined) continue
    defaults.set(name, fallback)
    // Compared exactly, as AMC does. These are the same float the firmware
    // wrote twice into one record, so a tolerance would only blur a genuine
    // difference of one least-significant bit.
    if (value !== fallback) changed.set(name, value)
  }

  return { values, defaults, changed }
}

/** Whether a log carries the `Default` column at all. */
export function logHasDefaults(
  messagesByType: ReadonlyMap<string, readonly LogMessage[]>
): boolean {
  for (const message of messagesByType.get('PARM') ?? []) {
    if (finite(message['Default']) !== undefined) return true
  }
  return false
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
