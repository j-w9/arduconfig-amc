/**
 * AMC's parameter files, including the one marker that changes their meaning.
 *
 * A step's `.param` file is mostly `NAME,VALUE  # why`. The exception is
 * `@manual_override`, which AMC treats as a persisted decision rather than a
 * comment: on a parameter the sequence *forces* or *derives*, it means the
 * operator deliberately chose a different value and the file's value wins over
 * the computed one.
 *
 * It is worth reading rather than ignoring. Without it, a template that
 * disagrees with the sequence looks like an inconsistency in the data --
 * Holybro_X500 keeps Medium Attitude logging on during PID notch tuning, which
 * reads as a bug until the marker is taken into account.
 */

/** The marker, as AMC spells it (data_model_par_dict.MANUAL_OVERRIDE_PREFIX). */
export const MANUAL_OVERRIDE_PREFIX = '@manual_override'

export interface ParamEntry {
  readonly name: string
  readonly value: number
  /** The operator's reason, with the marker stripped. */
  readonly comment?: string
  /**
   * The operator chose this value over the one the sequence computes.
   *
   * Only meaningful on a forced or derived parameter -- AMC ignores the marker
   * elsewhere, and so does anything reading this -- so the flag records what
   * the file says and leaves that judgement to the caller.
   */
  readonly manualOverride: boolean
}

/**
 * Parse a `.param` file.
 *
 * Tolerant in the same places AMC is: blank lines, `#` comments, and either a
 * comma or whitespace between the name and the value.
 */
export function parseParamFile(text: string): Map<string, ParamEntry> {
  const entries = new Map<string, ParamEntry>()
  for (const raw of text.split(/\r?\n/)) {
    const hash = raw.indexOf('#')
    const body = (hash === -1 ? raw : raw.slice(0, hash)).trim()
    if (body.length === 0) continue

    const match = /^(\S+)[,\s]+(\S+)$/.exec(body)
    if (!match) continue
    const value = Number(match[2])
    if (Number.isNaN(value)) continue

    const rawComment = hash === -1 ? '' : raw.slice(hash + 1).trim()
    const manualOverride = rawComment.startsWith(MANUAL_OVERRIDE_PREFIX)
    const comment = manualOverride
      ? rawComment.slice(MANUAL_OVERRIDE_PREFIX.length).trimStart()
      : rawComment

    entries.set(match[1] as string, {
      name: match[1] as string,
      value,
      manualOverride,
      ...(comment.length === 0 ? {} : { comment })
    })
  }
  return entries
}

/** Just the values, for evaluating `fc_parameters`. */
export function parameterValues(entries: ReadonlyMap<string, ParamEntry>): Record<string, number> {
  const values: Record<string, number> = {}
  for (const [name, entry] of entries) values[name] = entry.value
  return values
}
