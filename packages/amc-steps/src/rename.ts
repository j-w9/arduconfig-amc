/**
 * Moving a step's parameters onto the connection this vehicle actually uses.
 *
 * The sequence's steps are written against one connection -- the RC receiver
 * step sets `SERIAL1_PROTOCOL` -- but the operator's receiver may be on
 * SERIAL3, or on a CAN port. A step declaring `rename_connection` names an
 * expression that resolves to the connection the vehicle declared, and its
 * parameters are moved onto that prefix before anything is written.
 *
 * Without it the sequence would configure a port the vehicle is not using and
 * leave the one it is using alone, which is worse than doing nothing: it looks
 * like it worked.
 *
 * Mirrors `_generate_connection_renames` and
 * `calculate_connection_rename_operations` in data_model_configuration_step.py.
 */

/** `SERIAL3` -> type `SERIAL`, number `3`. Multi-digit instances included. */
const PREFIX = /^([A-Z]+)(\d+)$/

/**
 * Work out what each parameter would be called on the given connection.
 *
 * Returns only the names that change. The three exception cases are AMC's and
 * are not guessable from the general rule: a CAN connection renames the
 * `CAN_Pn` and `CAN_Dn` families rather than the `CANn` one, and a serial
 * connection renames `BRD_SERn`, whose prefix does not contain "SERIAL" at all.
 */
export function connectionRenames(
  parameterNames: readonly string[],
  connection: string
): Map<string, string> {
  const renames = new Map<string, string>()
  const match = PREFIX.exec(connection)
  // Anything that is not a prefix and an instance number -- "None", say -- is
  // not a connection to move onto, and renames nothing.
  if (!match) return renames

  const type = match[1] as string
  const number = match[2] as string

  for (const name of parameterNames) {
    const parts = name.split('_')
    let oldPrefix = parts[0] as string
    let newPrefix = connection
    let exception = false

    if (type === 'CAN' && parts.length >= 2 && parts[0] === 'CAN' && /^P\d+$/.test(parts[1] as string)) {
      oldPrefix += `_${parts[1]}`
      newPrefix = `CAN_P${number}`
      exception = true
    }
    if (type === 'CAN' && parts.length >= 2 && parts[0] === 'CAN' && /^D\d+$/.test(parts[1] as string)) {
      oldPrefix += `_${parts[1]}`
      newPrefix = `CAN_D${number}`
      exception = true
    }
    if (type === 'SERIAL' && parts.length >= 2 && parts[0] === 'BRD' && /^SER\d+$/.test(parts[1] as string)) {
      oldPrefix += `_${parts[1]}`
      newPrefix = `BRD_SER${number}`
      exception = true
    }

    if (type.length > 0 && (oldPrefix.includes(type) || exception)) {
      renames.set(name, name.replace(oldPrefix, newPrefix))
    }
  }

  return renames
}

export interface RenamePlan {
  /** Renames that can be applied, old name to new. */
  readonly renames: ReadonlyMap<string, string>
  /**
   * Renames refused because the destination name is already in use.
   *
   * Left alone rather than merged: two parameters wanting the same name is
   * something for the operator to look at, not for this to resolve quietly.
   */
  readonly conflicts: readonly string[]
}

/** Which renames are safe to apply to this set of parameters. */
export function planConnectionRenames(
  parameterNames: readonly string[],
  connection: string
): RenamePlan {
  const proposed = connectionRenames(parameterNames, connection)
  // Seeded with every existing name, so a rename can never land on a
  // parameter that is already there.
  const taken = new Set(parameterNames)
  const renames = new Map<string, string>()
  const conflicts: string[] = []

  for (const [oldName, newName] of proposed) {
    if (oldName === newName) continue
    if (taken.has(newName)) {
      conflicts.push(oldName)
      continue
    }
    taken.add(newName)
    renames.set(oldName, newName)
  }

  return { renames, conflicts }
}
