/**
 * What a connection's Type implies about its Protocol.
 *
 * A component's connection is two fields that are not independent: a CAN
 * connection carries DroneCAN, a serial one carries a serial protocol, an
 * analog one carries an analog reading. Offering all protocols under every
 * type invites a declaration the sequence cannot resolve, and the operator has
 * no way to know which of thirty entries their wiring actually supports.
 *
 * The pairings are observed from AMC's own vehicle templates (emitted by
 * scripts/sync-from-vendor.mjs), which makes them EVIDENCE rather than a
 * specification. So they reorder a field's choices; they never remove one.
 * Twenty-nine templates cannot prove that a protocol nobody happened to use is
 * invalid, and hiding a valid option is a worse failure than listing an
 * unlikely one — the operator can see their own hardware, and we cannot.
 */

/** `{ "ESC/FC->ESC Connection": { "Main Out": ["DShot600", "Normal"] } }` */
export type ConnectionPairings = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>

/** The group a field belongs to, e.g. `ESC/FC->ESC Connection` for its Protocol. */
export function connectionGroupOf(path: readonly string[]): string | undefined {
  // A connection field is `<Component>/<Group>/<Type|Protocol>`; anything else
  // has no counterpart to be constrained by.
  if (path.length !== 3) return undefined
  const leaf = path[2]
  if (leaf !== 'Protocol' && leaf !== 'Type') return undefined
  return `${path[0]}/${path[1]}`
}

/**
 * Order `options` by whether they have been seen with the declared type.
 *
 * Returns the options unchanged when nothing is declared or nothing is known,
 * so a caller can apply this unconditionally.
 */
export function orderByPairing(
  options: readonly string[],
  pairings: ConnectionPairings,
  group: string | undefined,
  declaredType: string | undefined
): { readonly ordered: readonly string[]; readonly likely: ReadonlySet<string> } {
  const empty = { ordered: options, likely: new Set<string>() }
  if (!group || !declaredType) return empty
  const seen = pairings[group]?.[declaredType]
  if (!seen || seen.length === 0) return empty

  const likely = new Set(seen)
  // A stable partition: the evidenced options first, everything else after, in
  // the order the caller already chose.
  const ordered = [...options.filter((o) => likely.has(o)), ...options.filter((o) => !likely.has(o))]
  // Anything the templates show but the documentation does not is still worth
  // offering — it is a value a real vehicle used.
  for (const value of seen) {
    if (!options.includes(value)) ordered.push(value)
  }
  return { ordered, likely }
}

/**
 * The protocols a connection TYPE can actually carry.
 *
 * Unlike the template pairings above, this is a rule rather than evidence: the
 * tables come from ArduPilot's own parameter values, so a GNSS on CAN1 speaks
 * DroneCAN and nothing else, and a GNSS on SERIAL3 speaks anything except
 * DroneCAN. Offering the whole list under every type invites a declaration the
 * sequence cannot resolve, and the operator has no way to know which of thirty
 * entries their wiring supports.
 *
 * Returns undefined when nothing is known — an unfamiliar type, or a component
 * with no table — because "no opinion" and "nothing is valid" are very
 * different answers and only one of them should empty a dropdown.
 */
export function protocolsForConnection(
  tables: ConnectionTablesLike,
  component: string,
  type: string
): ReadonlySet<string> | undefined {
  const table = CONNECTION_TABLES[component]
  if (!table) return undefined

  const entries = tables[table] as Readonly<Record<string, { type: readonly string[]; protocol: string }>> | undefined
  if (!entries) return undefined

  const protocols = new Set<string>()
  let sawType = false
  for (const entry of Object.values(entries)) {
    if (!entry?.type?.includes(type)) continue
    sawType = true
    protocols.add(entry.protocol)
  }
  // A type no entry mentions is one this version has not heard of. Saying
  // nothing beats emptying the list on a vehicle newer than these tables.
  return sawType ? protocols : undefined
}

/**
 * Which table governs a component's connection.
 *
 * Only the components whose protocol is enumerated by a PARAMETER appear here.
 * A telemetry radio's protocol comes from SERIAL*_PROTOCOL, which is a list of
 * every serial protocol rather than a per-type rule, so constraining it would
 * be inventing a rule ArduPilot does not have.
 */
const CONNECTION_TABLES: Readonly<Record<string, keyof ConnectionTablesLike>> = {
  'GNSS Receiver': 'GNSS_RECEIVER_CONNECTION',
  'Battery Monitor': 'BATT_MONITOR_CONNECTION',
  'RC Receiver': 'RC_PROTOCOLS_DICT'
}

/** The parts of the connection tables this module reads. */
interface ConnectionTablesLike {
  readonly GNSS_RECEIVER_CONNECTION?: unknown
  readonly BATT_MONITOR_CONNECTION?: unknown
  readonly RC_PROTOCOLS_DICT?: unknown
}
