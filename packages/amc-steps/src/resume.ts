/**
 * Where to pick the sequence up again.
 *
 * AMC's method is something an operator works through over days, not in one
 * sitting: cool the controller overnight for the temperature calibration, fly
 * it, come back for the notch filters. Losing your place is a real cost, so
 * the directory records the last step that was written and the next session
 * starts after it.
 *
 * The "after" matters. Resuming AT the last written step invites writing it
 * twice, and a step that has already been applied and rebooted through is
 * done — the operator's next question is what comes next, not whether that
 * one took.
 */

import type { OrderedStep } from './types.js'

/** What the directory records, as AMC names the file. */
export const LAST_WRITTEN_FILENAME = 'last_uploaded_filename.txt'

export interface ResumePoint {
  /** The step to open, or undefined when the sequence has nothing to resume. */
  readonly filename?: string
  /** Why that step: worth saying, because "start over" surprises people. */
  readonly reason: 'after-last-written' | 'finished' | 'unrecognised' | 'fresh'
  /** The step the directory says was written last, when it named a real one. */
  readonly lastWritten?: string
}

/**
 * Decide where to resume, given what the directory recorded.
 *
 * `lastWritten` is whatever the file held — including a step name this
 * sequence no longer has, which is the case that matters: a directory written
 * by an older AMC names steps this one renamed, so the name is resolved
 * through `old_filenames` before being called unrecognised.
 */
export function resumePoint(
  sequence: readonly OrderedStep[],
  lastWritten: string | undefined
): ResumePoint {
  if (sequence.length === 0) return { reason: 'fresh' }

  const first = sequence[0]?.filename
  const recorded = lastWritten?.trim()
  if (!recorded) return { ...(first ? { filename: first } : {}), reason: 'fresh' }

  // Resolve through the renames first: a directory from an older AMC records
  // a name this sequence has since changed, and treating that as unrecognised
  // would send the operator back to the beginning of a sequence they had
  // nearly finished.
  const index = sequence.findIndex(
    ({ filename, step }) => filename === recorded || (step.old_filenames ?? []).includes(recorded)
  )
  if (index === -1) {
    return { ...(first ? { filename: first } : {}), reason: 'unrecognised' }
  }

  const resolved = sequence[index]?.filename
  const next = sequence[index + 1]?.filename
  if (next === undefined) {
    // The last step was written: the sequence is done. Reopening at the start
    // would suggest otherwise.
    return { reason: 'finished', ...(resolved ? { lastWritten: resolved } : {}) }
  }
  return {
    filename: next,
    reason: 'after-last-written',
    ...(resolved ? { lastWritten: resolved } : {})
  }
}

/** The file recording where the operator got to, for the written directory. */
export function lastWrittenFile(filename: string): { filename: string; text: string } {
  // A trailing newline, as AMC writes it, so the two agree byte for byte.
  return { filename: LAST_WRITTEN_FILENAME, text: `${filename}\n` }
}

/** What a directory's `last_uploaded_filename.txt` recorded, if it held one. */
export function lastWrittenFrom(
  files: readonly { readonly filename: string; readonly text: string }[]
): string | undefined {
  const file = files.find((entry) => basename(entry.filename) === LAST_WRITTEN_FILENAME)
  const recorded = file?.text.trim()
  return recorded ? recorded : undefined
}

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash === -1 ? path : path.slice(slash + 1)
}
