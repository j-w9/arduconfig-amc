/**
 * Bringing a directory an older AMC wrote up to the current layout.
 *
 * `old_filenames` in the step files covers the renames, and reading a project
 * already honours them. What it cannot express is the rest of what changed
 * between format version 0 and 1: parameters that *moved* from one step's file
 * into another's, files that did not exist before, and files the sequence has
 * since dropped.
 *
 * Without this a pre-v1 directory reads *almost* correctly, which is the worst
 * way for it to be wrong. `BRD_HEAT_TARG` stays in the board-orientation file
 * rather than the temperature-calibration one, so the step that owns it now
 * shows nothing recorded; and `09_batt2.param`, which AMC deletes deliberately,
 * is reported as a file left unread -- an operator being told their work was
 * dropped when in fact it was retired upstream.
 *
 * The tables are extracted from `backend_filesystem_migration.py` rather than
 * transcribed (scripts/extract-connection-tables.py -> steps/migration.json).
 */

import { parseParamFile } from './param-file.js'

/** What `steps/migration.json` holds. */
export interface MigrationTables {
  readonly VEHICLE_COMPONENTS_FORMAT_VERSION: number
  /** Keyed by vehicle type, plus `all`. Each entry is [from, to, patterns]. */
  readonly PARAM_MOVES_V0_TO_V1: Readonly<Record<string, readonly (readonly [string, string, readonly string[]])[]>>
  /** Files with fixed content, created only when absent. Each is [name, content]. */
  readonly NEW_FILES_V0_TO_V1: Readonly<Record<string, readonly (readonly [string, string])[]>>
  readonly FILES_TO_DELETE_V0_TO_V1: Readonly<Record<string, readonly string[]>>
}

export interface MigratableFile {
  readonly filename: string
  readonly text: string
}

export interface Migration {
  /** The directory as the current format wants it. */
  readonly files: readonly MigratableFile[]
  /** Which parameters moved, and where to. */
  readonly moved: readonly { readonly parameter: string; readonly from: string; readonly to: string }[]
  /** Files created because the current sequence has a step for them. */
  readonly created: readonly string[]
  /**
   * Files the sequence has dropped.
   *
   * Named rather than silently removed: one still holding parameters is an
   * operator's work going away, and AMC warns about exactly that case.
   */
  readonly removed: readonly { readonly filename: string; readonly parameters: readonly string[] }[]
  readonly from: number
  readonly to: number
}

/**
 * The format version a directory's `vehicle_components.json` declares.
 *
 * Absent means 0: the field was introduced by the version that needed it, so
 * a document without one predates it.
 */
export function formatVersionOf(componentsJson: string | undefined): number {
  if (componentsJson === undefined) return 0
  try {
    const parsed = JSON.parse(componentsJson) as { 'Format version'?: unknown }
    const declared = parsed['Format version']
    return typeof declared === 'number' ? declared : 0
  } catch {
    // An unreadable declaration is not evidence of a modern directory.
    return 0
  }
}

/** The firmware the directory was written for, which selects type-specific moves. */
export function vehicleTypeOf(componentsJson: string | undefined): string {
  if (componentsJson === undefined) return ''
  try {
    const parsed = JSON.parse(componentsJson) as {
      Components?: { 'Flight Controller'?: { Firmware?: { Type?: unknown } } }
    }
    const type = parsed.Components?.['Flight Controller']?.Firmware?.Type
    return typeof type === 'string' ? type : ''
  } catch {
    return ''
  }
}

/** Python's `re.fullmatch` over the parameter name. */
function matchesAny(name: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    try {
      if (new RegExp(`^(?:${pattern})$`).exec(name)) return true
    } catch {
      // A pattern this engine cannot compile moves nothing, rather than
      // taking the migration down.
    }
  }
  return false
}

/** Split a file's lines into the ones a pattern list claims and the rest. */
function extract(text: string, patterns: readonly string[]): { taken: string[]; left: string[] } {
  const taken: string[] = []
  const left: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const [name] = parseParamFile(line).keys()
    if (name !== undefined && matchesAny(name, patterns)) taken.push(line)
    else left.push(line)
  }
  return { taken, left }
}

function textOf(lines: readonly string[]): string {
  return lines.length === 0 ? '' : lines.join('\n') + '\n'
}

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash === -1 ? path : path.slice(slash + 1)
}

/**
 * Migrate a directory, if it needs it.
 *
 * Returns `undefined` when the directory already declares the current format,
 * so a caller can tell "nothing to do" from "migrated to the same thing".
 *
 * AMC runs the `all` entries before any vehicle-specific ones and this keeps
 * that order: a later move can take a parameter out of a file an earlier one
 * has already written.
 */
export function migrateProject(
  files: readonly MigratableFile[],
  tables: MigrationTables,
  options: { readonly componentsJson?: string; readonly vehicleType?: string } = {}
): Migration | undefined {
  const componentsJson =
    options.componentsJson ?? files.find((file) => basename(file.filename) === 'vehicle_components.json')?.text
  const from = formatVersionOf(componentsJson)
  const to = tables.VEHICLE_COMPONENTS_FORMAT_VERSION
  if (from >= to) return undefined

  const vehicleType = options.vehicleType ?? vehicleTypeOf(componentsJson)
  const byName = new Map(files.map((file) => [basename(file.filename), { ...file }]))
  const moved: { parameter: string; from: string; to: string }[] = []

  // A vehicle type the tables have never heard of still gets the `all` moves;
  // AMC logs and carries on rather than refusing the whole migration.
  const keysFor = <T>(table: Readonly<Record<string, readonly T[]>>): readonly T[] => [
    ...(table['all'] ?? []),
    ...(vehicleType && table[vehicleType] ? (table[vehicleType] as readonly T[]) : [])
  ]

  // Step 1: parameters move out of their old files into their new ones.
  const accumulated = new Map<string, string[]>()
  for (const [source, destination, patterns] of keysFor(tables.PARAM_MOVES_V0_TO_V1)) {
    const file = byName.get(source)
    if (!file) continue
    const { taken, left } = extract(file.text, patterns)
    if (taken.length === 0) continue
    // Removed from the source as they are taken, which is what makes a second
    // run a no-op rather than a duplication.
    byName.set(source, { ...file, text: textOf(left) })
    const into = accumulated.get(destination) ?? []
    into.push(...taken)
    accumulated.set(destination, into)
    for (const line of taken) {
      const [name] = parseParamFile(line).keys()
      if (name !== undefined) moved.push({ parameter: name, from: source, to: destination })
    }
  }

  for (const [destination, lines] of accumulated) {
    const existing = byName.get(destination)
    const already = existing ? new Set(parseParamFile(existing.text).keys()) : new Set<string>()
    // A parameter the destination already holds is left alone: the
    // destination's own value is the newer statement about it.
    const fresh = lines.filter((line) => {
      const [name] = parseParamFile(line).keys()
      return name !== undefined && !already.has(name)
    })
    if (fresh.length === 0) continue
    const before = existing ? existing.text.split(/\r?\n/).filter((line) => line.trim().length > 0) : []
    byName.set(destination, { filename: destination, text: textOf([...before, ...fresh]) })
  }

  // Step 2: files the new layout has that the old one did not.
  const created: string[] = []
  for (const [filename, content] of keysFor(tables.NEW_FILES_V0_TO_V1)) {
    if (byName.has(filename)) continue
    // Written verbatim: AMC uses `writelines`, which adds nothing, and these
    // literals already carry their own trailing newline. Running them through
    // the line joiner would leave every created file with a blank last line.
    byName.set(filename, { filename, text: content })
    created.push(filename)
  }

  // Step 3: files the sequence has dropped.
  const removed: { filename: string; parameters: readonly string[] }[] = []
  for (const filename of keysFor(tables.FILES_TO_DELETE_V0_TO_V1)) {
    const file = byName.get(filename)
    if (!file) continue
    removed.push({ filename, parameters: [...parseParamFile(file.text).keys()] })
    byName.delete(filename)
  }

  return { files: [...byName.values()], moved, created, removed, from, to }
}

/** The declaration with its format version brought up to date. */
export function withFormatVersion(componentsJson: string, version: number): string {
  try {
    const parsed = JSON.parse(componentsJson) as Record<string, unknown>
    return JSON.stringify({ ...parsed, 'Format version': version }, null, 4) + '\n'
  } catch {
    return componentsJson
  }
}
