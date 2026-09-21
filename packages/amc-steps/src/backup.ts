/**
 * What the aircraft held before any of this touched it.
 *
 * AMC writes two snapshots of the flight controller's parameters into the
 * vehicle directory (`__main__.backup_fc_parameters`):
 *
 *   - `autobackup_00_before_ardupilot_methodic_configurator.param`, written
 *     once and never overwritten, and only into a directory that has not been
 *     used yet. This is the one that matters: the vehicle exactly as it was
 *     before the method ran, which is what you want back when a configuration
 *     turns out wrong and the tuning that flew is two weeks of edits ago.
 *   - `autobackup_NN.param`, a fresh number each session, so the intermediate
 *     states are recoverable too.
 *
 * Neither is a step and neither is read back. They exist for the moment
 * something has gone wrong, which is exactly when regenerating them is no
 * longer possible.
 */

import { type ParamLine, writeParamFile } from './param-file-writer.js'

/** AMC's name for the snapshot taken before the method has run at all. */
export const FIRST_BACKUP = 'autobackup_00_before_ardupilot_methodic_configurator.param'

/** AMC caps the numbered backups here and then overwrites the last. */
export const MAX_BACKUP = 99

export interface BackupFile {
  readonly filename: string
  readonly text: string
  readonly count: number
}

export interface BackupOptions {
  /**
   * Names already in the directory.
   *
   * Decides both whether the first backup has been taken and which number the
   * next session's gets. A directory nobody has opened yet holds neither.
   */
  readonly existing?: Iterable<string>
  /**
   * Whether the directory has been used -- AMC checks for
   * `last_uploaded_filename.txt`.
   *
   * The first backup is skipped when it has, because by then the vehicle has
   * already been written to and a snapshot of it is no longer a snapshot of
   * what was there before.
   */
  readonly alreadyStarted?: boolean
}

/**
 * The backup files to add to a directory for this session.
 *
 * Returns nothing when there are no parameters: a vehicle that has not
 * reported anything has nothing to snapshot, and an empty backup would
 * assert that the aircraft was blank.
 */
export function backupFiles(
  parameters: Readonly<Record<string, number>>,
  options: BackupOptions = {}
): readonly BackupFile[] {
  const names = new Set(options.existing ?? [])
  const entries = Object.entries(parameters)
  if (entries.length === 0) return []

  const lines: ParamLine[] = entries
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const text = writeParamFile(lines)

  const files: BackupFile[] = []

  // Once, and only into a directory the method has not been run in.
  if (!names.has(FIRST_BACKUP) && options.alreadyStarted !== true) {
    files.push({ filename: FIRST_BACKUP, text, count: lines.length })
  }

  const numbered = nextBackupNumber(names)
  files.push({
    filename: `autobackup_${String(numbered).padStart(2, '0')}.param`,
    text,
    count: lines.length
  })

  return files
}

/**
 * The next free backup number, counting from 1 as AMC does.
 *
 * At the cap it returns the cap, which overwrites the highest rather than
 * growing without limit -- AMC's own choice, and the alternative is a
 * directory that fills up with snapshots nobody asked for.
 */
export function nextBackupNumber(existing: Iterable<string>): number {
  const names = existing instanceof Set ? existing : new Set(existing)
  let number = 1
  while (names.has(`autobackup_${String(number).padStart(2, '0')}.param`)) {
    number += 1
    if (number > MAX_BACKUP) return MAX_BACKUP
  }
  return number
}
