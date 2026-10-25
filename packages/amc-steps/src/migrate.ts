/**
 * Bringing a directory an older AMC wrote up to the current layout.
 *
 * Opening a project in AMC does two things, in this order
 * (data_model_vehicle_project_opener): `migrate_vehicle_project_if_needed`
 * moves parameters between step files, creates and restores files the current
 * layout has, and deletes retired ones; then `rename_parameter_files` applies
 * the `old_filenames` aliases. `openProjectLikeAmc` is both, and is checked
 * byte for byte against AMC 5.0.0 opening every vehicle AMC 4.5.7 shipped
 * (scripts/gen_migration_v2_fixture.py).
 *
 * Format version 1 -> 2 is the big one. AMC 5.0.0 renumbered every step and
 * split the old combined `14_mp_setup_mandatory_hardware.param` into separate
 * accelerometer, level, compass, servo-output and flight-mode steps. Without
 * this a 4.5.x project's calibration would sit in a file no step reads.
 *
 * Python's file semantics are reproduced rather than approximated, because a
 * difference shows up as a change in the operator's files: lines are read
 * with universal newlines and a stripped byte-order mark, kept with their line
 * endings, and written back with LF. A file AMC does not rewrite keeps its
 * bytes exactly.
 *
 * The tables are extracted from `backend_filesystem_migration.py` rather than
 * transcribed (scripts/extract-connection-tables.py -> steps/migration.json).
 */

import { pyInt, PyObject, pyJsonDumps, pyJsonLoads, pyIsInt, type PyValue } from './python-json.js'

type Move = readonly [string, string, readonly string[]]
type MoveV2 = readonly [string, string, readonly string[], boolean]
type CopyV2 = readonly [string, string, string, readonly string[]]
type DeleteV2 = readonly [string, readonly string[]]
type ByVehicle<T> = Readonly<Record<string, readonly T[]>>

/** What `steps/migration.json` holds. */
export interface MigrationTables {
  readonly VEHICLE_COMPONENTS_FORMAT_VERSION: number
  /** Keyed by vehicle type, plus `all`. Each entry is [from, to, patterns]. */
  readonly PARAM_MOVES_V0_TO_V1: ByVehicle<Move>
  /** Files with fixed content, created only when absent. Each is [name, content]. */
  readonly NEW_FILES_V0_TO_V1: ByVehicle<readonly [string, string]>
  readonly FILES_TO_DELETE_V0_TO_V1: ByVehicle<string>
  /** [from, to, patterns, force]. Force lets a later file's value replace an earlier one's. */
  readonly PARAM_MOVES_V1_TO_V2?: ByVehicle<MoveV2>
  /** [from, step the values moved into, also copy them to, patterns]. */
  readonly PARAM_COPIES_V1_TO_V2?: ByVehicle<CopyV2>
  readonly PARAM_DELETES_V1_TO_V2?: ByVehicle<DeleteV2>
  readonly GENERAL_CONFIGURATION_FILENAMES?: Readonly<Record<string, string>>
  readonly MANDATORY_HARDWARE_OLD_FILENAMES?: Readonly<Record<string, readonly string[]>>
  readonly V1_TO_V2_PROVENANCE_FILENAME?: string
}

/** The parts of a configuration step the migration reads. */
export interface MigrationStep {
  readonly old_filenames?: readonly string[]
}

/** Everything opening a project needs besides the project itself. */
export interface MigrationContext {
  readonly tables: MigrationTables
  /** AMC's configuration steps, by vehicle type, in file order. */
  readonly steps?: Readonly<Record<string, Readonly<Record<string, MigrationStep>>>>
  /**
   * The empty templates' files, by vehicle type and then `major.minor`
   * (steps/baselines.json), plus any per-step `.pdef.xml` sidecars.
   */
  readonly templates?: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>
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
  /**
   * Parameters no rule claimed, put where the operator will be shown them.
   *
   * AMC copies anything left over in the old combined hardware step into the
   * general-configuration step "for review" rather than dropping it.
   */
  readonly surfaced: readonly { readonly parameter: string; readonly from: string; readonly to: string }[]
  /** Parameters the new layout no longer keeps, taken out of the file they were in. */
  readonly dropped: readonly { readonly parameter: string; readonly from: string }[]
  /** Files created because the current sequence has a step for them. */
  readonly created: readonly string[]
  /** Of those, the ones seeded from the empty template for this firmware. */
  readonly restored: readonly string[]
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

const COMPONENTS = 'vehicle_components.json'
const PROVENANCE_DEFAULT = '.migration-v1-to-v2.json'
const MANDATORY_HARDWARE = '14_mp_setup_mandatory_hardware.param'

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash === -1 ? path : path.slice(slash + 1)
}

/** A component document parsed the way AMC parses it, or undefined if Python would fail. */
function loadComponents(text: string | undefined): PyObject | undefined {
  if (text === undefined) return undefined
  try {
    const parsed = pyJsonLoads(stripBom(text))
    return parsed instanceof PyObject ? parsed : undefined
  } catch {
    return undefined
  }
}

function stripBom(text: string): string {
  return text.startsWith('﻿') ? text.slice(1) : text
}

function child(value: PyValue | undefined, key: string): PyValue | undefined {
  return value instanceof PyObject ? value.get(key) : undefined
}

function firmwareField(components: PyObject | undefined, key: string): string {
  const value = child(child(child(child(components, 'Components'), 'Flight Controller'), 'Firmware'), key)
  return typeof value === 'string' ? value : ''
}

/**
 * The format version a directory's `vehicle_components.json` declares.
 *
 * Absent means 0: the field was introduced by the version that needed it, so
 * a document without one predates it.
 */
export function formatVersionOf(componentsJson: string | undefined): number {
  const declared = loadComponents(componentsJson)?.get('Format version')
  return pyIsInt(declared) ? Number(declared.digits) : 0
}

/** The firmware the directory was written for, which selects type-specific moves. */
export function vehicleTypeOf(componentsJson: string | undefined): string {
  return firmwareField(loadComponents(componentsJson), 'Type')
}

/** The declaration with its format version set, written as AMC writes it. */
export function withFormatVersion(componentsJson: string, version: number): string {
  const components = loadComponents(componentsJson)
  if (!components) return componentsJson
  components.set('Format version', pyInt(version))
  return pyJsonDumps(components, 4).replace(/\n+$/, '') + '\n'
}

// ---------------------------------------------------------------------------
// Python's file model
// ---------------------------------------------------------------------------

/** `open(path, encoding="utf-8-sig").readlines()`: universal newlines, endings kept. */
function readLines(text: string): string[] {
  const normalized = stripBom(text).replace(/\r\n?/g, '\n')
  const lines: string[] = []
  let start = 0
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '\n') {
      lines.push(normalized.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < normalized.length) lines.push(normalized.slice(start))
  return lines
}

/** `fh.writelines(lines)` with `newline="\n"`: written exactly as given. */
function writeLines(lines: readonly string[]): string {
  return lines.join('')
}

/** AMC's `_param_name_from_line`: comma first, then space, then tab. */
export function paramNameFromLine(line: string): string {
  let stripped = line.trim()
  if (!stripped || stripped.startsWith('#')) return ''
  if (stripped.includes('#')) stripped = (stripped.split('#', 1)[0] as string).trim()
  if (!stripped) return ''
  for (const separator of [',', ' ', '\t']) {
    const at = stripped.indexOf(separator)
    if (at !== -1) return stripped.slice(0, at).trim()
  }
  return stripped
}

const compiled = new Map<string, RegExp | null>()

/** Python's `re.fullmatch` over the parameter name. */
function matchesAny(name: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    let regex = compiled.get(pattern)
    if (regex === undefined) {
      try {
        regex = new RegExp(`^(?:${pattern})$`)
      } catch {
        // A pattern this engine cannot compile moves nothing, rather than
        // taking the migration down -- AMC logs and skips a malformed one.
        regex = null
      }
      compiled.set(pattern, regex)
    }
    if (regex?.test(name)) return true
  }
  return false
}

function partition(lines: readonly string[], patterns: readonly string[]): { taken: string[]; left: string[] } {
  const taken: string[] = []
  const left: string[] = []
  for (const line of lines) {
    const name = paramNameFromLine(line)
    if (name && matchesAny(name, patterns)) taken.push(line)
    else left.push(line)
  }
  return { taken, left }
}

function namesOf(lines: readonly string[]): string[] {
  return lines.map(paramNameFromLine).filter((name) => name.length > 0)
}

/** The directory as an ordered map of files, the way the migration sees a folder. */
class Directory {
  readonly files = new Map<string, string>()
  constructor(files: readonly MigratableFile[]) {
    for (const file of files) this.files.set(basename(file.filename), file.text)
  }
  has(name: string): boolean {
    return this.files.has(name)
  }
  lines(name: string): string[] {
    const text = this.files.get(name)
    return text === undefined ? [] : readLines(text)
  }
  write(name: string, lines: readonly string[]): void {
    this.files.set(name, writeLines(lines))
  }
  remove(name: string): void {
    this.files.delete(name)
  }
  paramNames(): string[] {
    return [...this.files.keys()].filter((name) => name.endsWith('.param'))
  }
}

function keysFor(table: ByVehicle<unknown> | undefined, vehicleType: string): string[] {
  return ['all', ...(vehicleType && table && vehicleType in table ? [vehicleType] : [])]
}

function rows<T>(table: ByVehicle<T> | undefined, key: string): readonly T[] {
  return table?.[key] ?? []
}

interface Report {
  moved: { parameter: string; from: string; to: string }[]
  surfaced: { parameter: string; from: string; to: string }[]
  dropped: { parameter: string; from: string }[]
  created: string[]
  restored: string[]
  removed: { filename: string; parameters: readonly string[] }[]
}

// ---------------------------------------------------------------------------
// Format version 0 -> 1
// ---------------------------------------------------------------------------

function migrateV0ToV1(directory: Directory, vehicleType: string, tables: MigrationTables, report: Report): Set<string> {
  const deleted = new Set<string>()
  // AMC runs the `all` entries before any vehicle-specific ones; a later move
  // can take a parameter out of a file an earlier one has already written.
  const accumulated = new Map<string, string[]>()
  for (const key of keysFor(tables.PARAM_MOVES_V0_TO_V1, vehicleType)) {
    for (const [source, destination, patterns] of rows(tables.PARAM_MOVES_V0_TO_V1, key)) {
      if (!directory.has(source)) continue
      const { taken, left } = partition(directory.lines(source), patterns)
      if (taken.length === 0) continue
      const into = accumulated.get(destination) ?? []
      into.push(...taken)
      accumulated.set(destination, into)
      // Removed from the source as they are taken, which is what makes a
      // second run a no-op rather than a duplication.
      directory.write(source, left)
      for (const parameter of namesOf(taken)) report.moved.push({ parameter, from: source, to: destination })
    }
  }

  for (const [destination, lines] of accumulated) {
    const existing = directory.has(destination) ? directory.lines(destination) : []
    // A parameter the destination already holds is left alone: the
    // destination's own value is the newer statement about it.
    const already = new Set(namesOf(existing))
    const fresh = lines.filter((line) => !already.has(paramNameFromLine(line)))
    if (fresh.length === 0) continue
    directory.write(destination, [...existing, ...fresh])
  }

  for (const key of keysFor(tables.NEW_FILES_V0_TO_V1, vehicleType)) {
    for (const [filename, content] of rows(tables.NEW_FILES_V0_TO_V1, key)) {
      if (directory.has(filename)) continue
      // Written verbatim: these literals carry their own trailing newline.
      directory.write(filename, content ? [content] : [])
      report.created.push(filename)
    }
  }

  for (const key of keysFor(tables.FILES_TO_DELETE_V0_TO_V1, vehicleType)) {
    for (const filename of rows(tables.FILES_TO_DELETE_V0_TO_V1, key)) {
      if (!directory.has(filename)) continue
      report.removed.push({ filename, parameters: namesOf(directory.lines(filename)) })
      directory.remove(filename)
      deleted.add(filename)
    }
  }
  return deleted
}

// ---------------------------------------------------------------------------
// Format version 1 -> 2
// ---------------------------------------------------------------------------

/** The configuration steps AMC would read: the project's own copy if it has a usable one. */
function stepsFor(
  directory: Directory,
  vehicleType: string,
  context: MigrationContext,
  /**
   * What a project copy AMC cannot use means. The migration reads it directly
   * and gives up on a bad one; opening the project validates it and falls
   * back to the packaged steps.
   */
  onBadLocalCopy: 'give-up' | 'use-packaged'
): Readonly<Record<string, MigrationStep>> | undefined {
  const local = directory.files.get(`configuration_steps_${vehicleType}.json`)
  if (local !== undefined) {
    let steps: unknown
    try {
      steps = (JSON.parse(stripBom(local)) as { steps?: unknown } | null)?.steps
    } catch {
      steps = undefined
    }
    if (steps && typeof steps === 'object' && !Array.isArray(steps)) return steps as Record<string, MigrationStep>
    if (onBadLocalCopy === 'give-up') return undefined
  }
  return context.steps?.[vehicleType]
}

function isPlainName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && basename(name) === name
}

function oldNamesOf(step: MigrationStep | undefined): readonly unknown[] {
  return step && Array.isArray(step.old_filenames) ? step.old_filenames : []
}

/** `_restore_missing_configuration_step_files`, from the empty template for this firmware. */
function restoreMissingStepFiles(
  directory: Directory,
  vehicleType: string,
  firmwareVersion: string,
  skip: ReadonlySet<string>,
  context: MigrationContext,
  report: Report
): void {
  const version = /(\d+)\.(\d+)/.exec(firmwareVersion)
  if (!vehicleType || !version) return
  const template = context.templates?.[vehicleType]?.[`${Number(version[1])}.${Number(version[2])}`]
  if (!template) return
  const steps = stepsFor(directory, vehicleType, context, 'give-up')
  if (!steps) return

  for (const [filename, step] of Object.entries(steps)) {
    if (!isPlainName(filename)) continue
    const source = template[filename]
    if (skip.has(filename) || directory.has(filename) || source === undefined) continue
    // The rename that runs after the migration will bring the operator's own
    // file across; restoring the template here would block it.
    if (oldNamesOf(step).some((old) => isPlainName(old) && directory.has(old))) continue
    const documentation = filename.replace(/\.param$/, '.pdef.xml')
    const sidecar = template[documentation]
    if (sidecar !== undefined && !directory.has(documentation)) directory.files.set(documentation, sidecar)
    directory.files.set(filename, source)
    report.created.push(filename)
    report.restored.push(filename)
  }
}

/** `_migration_destination_paths`: a step whose file is missing or empty writes into its legacy alias. */
function destinationAliases(
  directory: Directory,
  vehicleType: string,
  context: MigrationContext
): Map<string, string> {
  const aliases = new Map<string, string>()
  const steps = stepsFor(directory, vehicleType, context, 'give-up')
  if (!steps) return aliases
  for (const [filename, step] of Object.entries(steps)) {
    if (!isPlainName(filename) || !step || typeof step !== 'object') continue
    const current = directory.files.get(filename)
    if (current !== undefined && current.length > 0) continue
    if (!Array.isArray(step.old_filenames)) continue
    for (const old of step.old_filenames) {
      if (isPlainName(old) && directory.has(old)) {
        aliases.set(filename, old)
        break
      }
    }
  }
  return aliases
}

/** `_merge_migrated_parameter_lines`: existing values stay unless their move is forced. */
function mergeMoved(existing: readonly string[], moved: readonly string[], forced: ReadonlySet<string>): string[] {
  const movedNames = new Set(namesOf(moved))
  const existingNames = new Set(namesOf(existing))
  const replace = new Set([...forced, ...[...movedNames].filter((name) => !existingNames.has(name))])
  const retained = existing.filter((line) => !replace.has(paramNameFromLine(line)))

  // The last occurrence of a moved name wins, in its own position.
  const unique: string[] = []
  const seen = new Set<string>()
  for (let i = moved.length - 1; i >= 0; i--) {
    const line = moved[i] as string
    const name = paramNameFromLine(line)
    if (name && seen.has(name)) continue
    if (name) {
      seen.add(name)
      if (existingNames.has(name) && !forced.has(name)) continue
    }
    unique.push(line)
  }
  unique.reverse()
  return [...retained, ...unique].map((line) => (line.endsWith('\n') || line.endsWith('\r') ? line : `${line}\n`))
}

function migrateV1ToV2(
  directory: Directory,
  vehicleType: string,
  preexisting: ReadonlySet<string>,
  context: MigrationContext,
  report: Report
): Set<string> {
  const { tables } = context
  const deleted = new Set<string>()
  const accumulated = new Map<string, string[]>()
  const forced = new Map<string, Set<string>>()
  const remaining = new Map<string, string[]>()
  const aliases = destinationAliases(directory, vehicleType, context)
  const force = (destination: string, lines: readonly string[]) => {
    const set = forced.get(destination) ?? new Set<string>()
    for (const name of namesOf(lines)) set.add(name)
    forced.set(destination, set)
  }
  const accumulate = (destination: string, lines: readonly string[]) => {
    const into = accumulated.get(destination) ?? []
    into.push(...lines)
    accumulated.set(destination, into)
  }

  const moveKeys = ['all', ...(vehicleType in (tables.PARAM_MOVES_V1_TO_V2 ?? {}) ? [vehicleType] : [])]
  for (const key of moveKeys) {
    // Sorted by source name only, and stably, as Python's sorted(key=...) is.
    const moves = [...rows(tables.PARAM_MOVES_V1_TO_V2, key)].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    for (const [source, destination, patterns, isForced] of moves) {
      if (!directory.has(source)) continue
      const lines = remaining.get(source) ?? directory.lines(source)
      const { taken, left } = partition(lines, patterns)
      if (taken.length === 0) {
        if (!remaining.has(source)) remaining.set(source, lines)
        continue
      }
      accumulate(destination, taken)
      const physical = aliases.get(destination) ?? destination
      // The original file order decides which value wins: a later file's
      // value replaces an earlier one's only when the move says it may.
      if (!preexisting.has(physical) || (isForced && source > physical)) force(destination, taken)
      remaining.set(source, left)
      for (const parameter of namesOf(taken)) report.moved.push({ parameter, from: source, to: destination })
    }
  }

  const copyKeys = ['all', ...(vehicleType in (tables.PARAM_COPIES_V1_TO_V2 ?? {}) ? [vehicleType] : [])]
  for (const key of copyKeys) {
    for (const [source, movedInto, destination, patterns] of rows(tables.PARAM_COPIES_V1_TO_V2, key)) {
      const copied = (accumulated.get(movedInto) ?? []).filter((line) => {
        const name = paramNameFromLine(line)
        return name && matchesAny(name, patterns)
      })
      if (copied.length === 0) continue
      accumulate(destination, copied)
      const physical = aliases.get(destination) ?? destination
      if (!preexisting.has(physical) || source > physical) force(destination, copied)
    }
  }

  // Whatever is left in the old combined hardware step goes where it will be
  // seen, rather than being deleted with the file.
  const general = tables.GENERAL_CONFIGURATION_FILENAMES?.[vehicleType] ?? '23_general_configuration.param'
  const surfaced = new Map<string, string[]>()
  if (vehicleType === 'ArduCopter') {
    // Copter drops the parameters its new layout no longer keeps, so only
    // what is neither moved nor obsolete is surfaced.
    const obsolete = new Map(rows(tables.PARAM_DELETES_V1_TO_V2, 'ArduCopter').map(([name, patterns]) => [name, patterns]))
    for (const [source, lines] of remaining) {
      const patterns = obsolete.get(source)
      if (!patterns) continue
      const unmapped = partition(lines, patterns).left.filter((line) => paramNameFromLine(line))
      if (unmapped.length > 0) surfaced.set(source, unmapped)
    }
  } else if (vehicleType === 'ArduPlane' || vehicleType === 'Heli' || vehicleType === 'Rover') {
    const hardware = new Set([MANDATORY_HARDWARE, ...(tables.MANDATORY_HARDWARE_OLD_FILENAMES?.[vehicleType] ?? [])])
    for (const [source, lines] of remaining) {
      if (!hardware.has(source)) continue
      const unmapped = lines.filter((line) => paramNameFromLine(line))
      if (unmapped.length > 0) surfaced.set(source, unmapped)
    }
  }
  const generalPhysical = aliases.get(general) ?? general
  const generalForced = forced.get(general) ?? new Set<string>()
  forced.set(general, generalForced)
  for (const [source, lines] of surfaced) {
    accumulate(general, lines)
    for (const parameter of namesOf(lines)) report.surfaced.push({ parameter, from: source, to: general })
    if (!preexisting.has(generalPhysical) || source > generalPhysical) {
      for (const name of namesOf(lines)) generalForced.add(name)
    }
  }

  for (const [destination, lines] of accumulated) {
    const physical = aliases.get(destination) ?? destination
    const existing = directory.has(physical) ? directory.lines(physical) : []
    if (!directory.has(physical)) report.created.push(destination)
    directory.write(physical, mergeMoved(existing, lines, forced.get(destination) ?? new Set()))
  }

  // Destinations are committed before the sources are trimmed, as AMC does.
  for (const [source, lines] of remaining) directory.write(source, lines)

  for (const key of ['all', ...(vehicleType in (tables.PARAM_DELETES_V1_TO_V2 ?? {}) ? [vehicleType] : [])]) {
    for (const [source, patterns] of rows(tables.PARAM_DELETES_V1_TO_V2, key)) {
      if (!directory.has(source)) continue
      const { taken, left } = partition(directory.lines(source), patterns)
      const named = namesOf(left)
      if (taken.length > 0) {
        for (const parameter of namesOf(taken)) report.dropped.push({ parameter, from: source })
        if (named.length > 0) directory.write(source, left)
        else {
          directory.remove(source)
          deleted.add(source)
          report.removed.push({ filename: source, parameters: [] })
        }
      } else if (remaining.has(source) && named.length === 0) {
        directory.remove(source)
        deleted.add(source)
        report.removed.push({ filename: source, parameters: [] })
      }
    }
  }
  return deleted
}

/** `rename_parameter_files`: apply the `old_filenames` aliases, sidecars included. */
function renameParameterFiles(directory: Directory, steps: Readonly<Record<string, MigrationStep>>): { from: string; to: string }[] {
  const renamed: { from: string; to: string }[] = []
  const renameSidecar = (from: string, to: string) => {
    const oldDocumentation = from.split('.param').join('.pdef.xml')
    const newDocumentation = to.split('.param').join('.pdef.xml')
    const text = directory.files.get(oldDocumentation)
    if (text === undefined || directory.has(newDocumentation)) return
    directory.remove(oldDocumentation)
    directory.files.set(newDocumentation, text)
  }
  for (const [filename, step] of Object.entries(steps)) {
    for (const old of oldNamesOf(step)) {
      if (typeof old !== 'string' || old === filename) continue
      if (directory.has(old)) {
        const current = directory.files.get(filename)
        if (current !== undefined) {
          // An empty placeholder gives way to the operator's legacy step; a
          // file with anything in it does not.
          if (current.length > 0) continue
          directory.remove(filename)
        }
        const text = directory.files.get(old) as string
        directory.remove(old)
        directory.files.set(filename, text)
        renamed.push({ from: old, to: filename })
        renameSidecar(old, filename)
      } else if (directory.has(filename)) {
        // Repairs a sidecar an interrupted rename left behind.
        renameSidecar(old, filename)
      }
    }
  }
  return renamed
}

/**
 * Migrate a directory, if it needs it.
 *
 * Returns `undefined` when the directory already declares the current format,
 * so a caller can tell "nothing to do" from "migrated to the same thing". The
 * `old_filenames` renames are not applied here; `openProjectLikeAmc` does both.
 */
export function migrateProject(
  files: readonly MigratableFile[],
  tablesOrContext: MigrationTables | MigrationContext,
  options: { readonly componentsJson?: string; readonly vehicleType?: string } = {}
): Migration | undefined {
  const context: MigrationContext = 'tables' in tablesOrContext ? tablesOrContext : { tables: tablesOrContext }
  const { tables } = context
  const directory = new Directory(files)
  const componentsText = options.componentsJson ?? directory.files.get(COMPONENTS)
  const components = loadComponents(componentsText)
  if (!components) return undefined

  const declared = components.get('Format version')
  const from = declared === undefined ? 0 : pyIsInt(declared) ? Number(declared.digits) : Number.NaN
  const to = tables.VEHICLE_COMPONENTS_FORMAT_VERSION
  if (!(from >= 0) || from >= to) return undefined

  const vehicleType = options.vehicleType ?? firmwareField(components, 'Type')
  const firmwareVersion = firmwareField(components, 'Version')
  const report: Report = { moved: [], surfaced: [], dropped: [], created: [], restored: [], removed: [] }
  const provenance = tables.V1_TO_V2_PROVENANCE_FILENAME ?? PROVENANCE_DEFAULT

  const skipRestore = new Set<string>()
  let version = from
  while (version < to) {
    const next = version + 1
    let deleted: Set<string>
    if (next === 1) {
      deleted = migrateV0ToV1(directory, vehicleType, tables, report)
    } else if (next === 2) {
      // The split overlays the operator's values onto the template defaults,
      // so the destinations are seeded first -- but not the files the split
      // reads from.
      const sources = new Set(
        ['all', ...(vehicleType in (tables.PARAM_MOVES_V1_TO_V2 ?? {}) ? [vehicleType] : [])].flatMap((key) =>
          rows(tables.PARAM_MOVES_V1_TO_V2, key).map(([source]) => source)
        )
      )
      // The file inventory before anything was restored decides precedence;
      // an interrupted earlier attempt left it behind.
      const recorded = directory.files.get(provenance)
      let preexisting: Set<string>
      try {
        preexisting = recorded === undefined ? new Set(directory.paramNames()) : new Set(JSON.parse(recorded) as string[])
      } catch {
        preexisting = new Set(directory.paramNames())
      }
      restoreMissingStepFiles(directory, vehicleType, firmwareVersion, new Set([...skipRestore, ...sources]), context, report)
      deleted = migrateV1ToV2(directory, vehicleType, preexisting, context, report)
    } else {
      break
    }
    for (const name of deleted) skipRestore.add(name)
    if (next === to) restoreMissingStepFiles(directory, vehicleType, firmwareVersion, skipRestore, context, report)

    // Every stage is persisted before the next runs, as AMC does.
    components.set('Format version', pyInt(next))
    directory.files.set(COMPONENTS, pyJsonDumps(components, 4).replace(/\n+$/, '') + '\n')
    if (next === 2) directory.remove(provenance)
    version = next
  }

  const created = [...new Set(report.created)].filter((name) => directory.has(name))
  return {
    files: [...directory.files].map(([filename, text]) => ({ filename, text })),
    moved: report.moved,
    surfaced: report.surfaced,
    dropped: report.dropped,
    created,
    restored: report.restored.filter((name) => directory.has(name)),
    removed: report.removed,
    from,
    to: version
  }
}

export interface OpenedProject {
  readonly files: readonly MigratableFile[]
  /** Set when the directory declared an older format. */
  readonly migration?: Migration
  /** Files that took their current step's name. */
  readonly renamed: readonly { readonly from: string; readonly to: string }[]
}

/**
 * Open a directory the way AMC does: migrate it, then apply the renames.
 *
 * The renames use the configuration steps of the vehicle the directory
 * declares, falling back to ArduCopter as AMC does when it cannot tell.
 */
export function openProjectLikeAmc(files: readonly MigratableFile[], context: MigrationContext): OpenedProject {
  const migration = migrateProject(files, context)
  const directory = new Directory(migration ? migration.files : files)
  const vehicleType = vehicleTypeOf(directory.files.get(COMPONENTS)) || 'ArduCopter'
  const steps = stepsFor(directory, vehicleType, context, 'use-packaged')
  const renamed = steps ? renameParameterFiles(directory, steps) : []
  return {
    files: [...directory.files].map(([filename, text]) => ({ filename, text })),
    ...(migration ? { migration } : {}),
    renamed
  }
}
