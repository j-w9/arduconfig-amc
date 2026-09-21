/**
 * Battery fields an older declaration does not have.
 *
 * `Volt per cell arm` and `Volt per cell min` were added to AMC's schema in
 * v2.11.0. A `vehicle_components.json` written before that has neither, and
 * the sequence reads both -- so opening such a directory leaves two of the
 * battery expressions with nothing to evaluate, and the steps that set the
 * failsafes quietly produce nothing.
 *
 * AMC fills them in (`migrate_legacy_battery_fields`) rather than asking,
 * because there is a better answer than a blank field: the vehicle's own
 * `BATT_ARM_VOLT` and `MOT_BAT_VOLT_MIN` divided by the cell count, falling
 * back to what the declared chemistry recommends.
 *
 * Separate from the v0-to-v1 directory migration, which moves parameters
 * between step files. This one is about the declaration.
 */

import type { ConnectionTables } from './connection-tables.js'

/** The parameter each missing field is derived from, and its field name. */
const DERIVED_FROM = [
  ['Volt per cell arm', 'BATT_ARM_VOLT'],
  ['Volt per cell min', 'MOT_BAT_VOLT_MIN']
] as const

/** AMC's canonical order for the battery specification fields. */
const FIELD_ORDER = ['Chemistry', 'Volt per cell max', 'Volt per cell arm', 'Volt per cell low', 'Volt per cell crit', 'Volt per cell min', 'Number of cells', 'Capacity mAh']

export interface LegacyBatteryFill {
  /** The field, keyed as the form keys it. */
  readonly key: string
  readonly field: string
  readonly value: number
  /** Where the number came from, which is worth telling the operator. */
  readonly source: 'vehicle' | 'chemistry'
}

/**
 * Work out the battery fields a declaration is missing.
 *
 * Returns nothing when the declaration is not a legacy one: AMC only fills
 * these in for a document that already has `Volt per cell max`, because a
 * battery nobody has described at all is a form to fill in rather than a file
 * to migrate.
 */
export function legacyBatteryFields(
  values: Readonly<Record<string, string>>,
  tables: ConnectionTables,
  options: { readonly parameters?: Readonly<Record<string, number>> } = {}
): readonly LegacyBatteryFill[] {
  const key = (field: string) => `Battery/Specifications/${field}`
  // Not a legacy declaration -- nothing has described this battery yet.
  if ((values[key('Volt per cell max')] ?? '') === '') return []

  const chemistry = values[key('Chemistry')] || tables.BATTERY_DEFAULT_CHEMISTRY
  const recommended = tables._recommended_battery_cell_voltages[chemistry]
  const cells = Number.parseInt(values[key('Number of cells')] ?? '', 10)

  const fills: LegacyBatteryFill[] = []
  for (const [field, parameter] of DERIVED_FROM) {
    if ((values[key(field)] ?? '') !== '') continue

    const pack = options.parameters?.[parameter]
    if (pack !== undefined && Number.isFinite(pack) && Number.isFinite(cells) && cells > 0) {
      // AMC rounds to four places: the quotient of two floats is not a
      // voltage anyone would write down.
      fills.push({ key: key(field), field, value: round(pack / cells, 4), source: 'vehicle' })
      continue
    }
    const fallback = recommended?.[field]
    if (typeof fallback === 'number') {
      fills.push({ key: key(field), field, value: fallback, source: 'chemistry' })
    }
  }
  return fills
}

/** Python's `round(x, 4)` closely enough for a cell voltage. */
function round(value: number, places: number): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

/** AMC's canonical order for the battery fields, for a caller that writes them. */
export function batteryFieldOrder(): readonly string[] {
  return FIELD_ORDER
}
