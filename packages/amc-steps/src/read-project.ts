/**
 * Reading a vehicle's configuration directory back in.
 *
 * The directory is the artefact AMC's method produces: one `.param` file per
 * step, `00_default.param` for the firmware's own values, and
 * `vehicle_components.json` for what the operator declared. Reading it back is
 * what makes the method worth following -- a configuration you cannot reopen a
 * year later is a configuration you have to redo.
 *
 * The one thing that makes this more than a directory listing is
 * `old_filenames`. The sequence has been renumbered and renamed over its
 * lifetime, so a directory written by an older AMC names steps differently
 * from the sequence reading it. Each step carries the names it used to have,
 * and a file found under one of them belongs to that step -- otherwise every
 * older project reads as "nothing matched" while sitting right there on disk.
 */

import { type ParamEntry, parseParamFile } from './param-file.js'
import type { OrderedStep } from './types.js'

/** A file handed in, however the caller got hold of it. */
export interface ProjectFile {
  readonly filename: string
  readonly text: string
}

export interface ReadStepFile {
  /** The step's filename in the sequence doing the reading. */
  readonly filename: string
  /** The name the file was actually found under -- differs after a rename. */
  readonly foundAs: string
  readonly entries: ReadonlyMap<string, ParamEntry>
}

/** A file claimed under an old name, and the current name it was claimed for. */
export interface ProjectRename {
  readonly from: string
  readonly to: string
}

export interface VehicleProject {
  readonly steps: readonly ReadStepFile[]
  /** `00_default.param`, absent in a directory written without a vehicle. */
  readonly defaults?: ReadonlyMap<string, number>
  /** `vehicle_components.json` verbatim, for the caller to parse and validate. */
  readonly components?: string
  /**
   * Every `@manual_override` in the directory, by parameter.
   *
   * Gathered across all steps because that is how it is used: a decision the
   * operator recorded once has to survive the directory being written again,
   * and the writer takes one map rather than hunting through per-step files.
   */
  readonly overrides: ReadonlyMap<string, { readonly value: number; readonly reason?: string }>
  /** Files claimed under a previous name. */
  readonly renamed: readonly ProjectRename[]
  /** Steps in the sequence that the directory has no file for. */
  readonly missing: readonly string[]
  /** Files no step in this sequence claims, including superseded old names. */
  readonly unmatched: readonly string[]
}

const DEFAULTS_FILENAME = '00_default.param'
const COMPONENTS_FILENAME = 'vehicle_components.json'

/**
 * Files a vehicle directory holds that are not steps.
 *
 * Reported as "left unread" they would look like the operator's work being
 * dropped, when in fact they are the directory's own bookkeeping: a summary
 * of what every step decided, a note of where the operator got to, the
 * parameters the sequence did not account for, and the documentation and
 * plots AMC writes alongside.
 */
const NON_STEP_FILES: ReadonlySet<string> = new Set([
  'complete.param',
  'reusable.param',
  'non-default_read-only.param',
  'non-default_writable_calibrations.param',
  'non-default_writable_ids.param',
  'non-default_writable_non-calibrations_non-ids.param',
  'fc_params_not_accounted_for.param',
  'last_uploaded_filename.txt',
  'apm.pdef.xml',
  'vehicle.jpg',
  'tempcal_gyro.png',
  'tempcal_acc.png',
  'tuning_report.csv'
])

/** AMC also writes per-step documentation beside each file. */
const NON_STEP_PATTERN = /\.pdef\.xml$|^fc_params_missing_or_different/

/**
 * Read a directory against a sequence.
 *
 * The sequence is what gives the files meaning, so reading a Copter directory
 * against the Plane sequence is not an error here -- it produces a great many
 * unmatched files, which is the honest report and lets a caller say so.
 */
export function readVehicleProject(
  sequence: readonly OrderedStep[],
  files: readonly ProjectFile[]
): VehicleProject {
  const byName = new Map<string, ProjectFile>()
  for (const file of files) {
    // Whatever the caller used to get the files -- a directory handle, a zip,
    // a multi-file picker -- may hand over paths rather than names.
    byName.set(basename(file.filename), file)
  }

  const steps: ReadStepFile[] = []
  const overrides = new Map<string, { value: number; reason?: string }>()
  const renamed: ProjectRename[] = []
  const missing: string[] = []
  const claimed = new Set<string>()

  for (const { filename, step } of sequence) {
    // The current name wins over an old one. A directory holding both is a
    // half-finished migration, and the file under the name this sequence uses
    // is the one that sequence wrote.
    const current = byName.get(filename)
    const found = current ?? firstMatch(step.old_filenames, byName)

    if (!found) {
      missing.push(filename)
      continue
    }
    claimed.add(found.filename === filename ? filename : basename(found.filename))
    if (found !== current) {
      renamed.push({ from: basename(found.filename), to: filename })
    }

    const entries = parseParamFile(found.text)
    for (const entry of entries.values()) {
      if (!entry.manualOverride) continue
      overrides.set(entry.name, {
        value: entry.value,
        ...(entry.comment ? { reason: entry.comment } : {})
      })
    }
    steps.push({ filename, foundAs: basename(found.filename), entries })
  }

  const defaultsFile = byName.get(DEFAULTS_FILENAME)
  const componentsFile = byName.get(COMPONENTS_FILENAME)
  const unmatched = [...byName.keys()]
    .filter(
      (name) =>
        !claimed.has(name) &&
        name !== DEFAULTS_FILENAME &&
        name !== COMPONENTS_FILENAME &&
        !NON_STEP_FILES.has(name) &&
        !NON_STEP_PATTERN.test(name)
    )
    .sort()

  return {
    steps,
    ...(defaultsFile ? { defaults: parameterValuesOf(defaultsFile.text) } : {}),
    ...(componentsFile ? { components: componentsFile.text } : {}),
    overrides,
    renamed,
    missing,
    unmatched
  }
}

function firstMatch(
  names: readonly string[] | undefined,
  byName: ReadonlyMap<string, ProjectFile>
): ProjectFile | undefined {
  for (const name of names ?? []) {
    const file = byName.get(basename(name))
    if (file) return file
  }
  return undefined
}

function parameterValuesOf(text: string): Map<string, number> {
  const values = new Map<string, number>()
  for (const entry of parseParamFile(text).values()) {
    values.set(entry.name, entry.value)
  }
  return values
}

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash === -1 ? path : path.slice(slash + 1)
}
