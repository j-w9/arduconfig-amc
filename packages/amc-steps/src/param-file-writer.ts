/**
 * Writing AMC's own artifact: a vehicle's per-step parameter files.
 *
 * A configured vehicle in AMC is a directory of numbered `.param` files, one
 * per step, each line a parameter with the reason it was set. That directory is
 * the thing an operator keeps, versions, and hands to someone else -- the
 * sequence is how it is produced, not what is produced.
 *
 * The format is small and exact, and both halves of it matter: a value is
 * rendered the way AMC renders it, so a file written here and a file written
 * there compare equal rather than differing in trailing zeros; and a value the
 * operator chose over the sequence's keeps its `@manual_override` marker, so
 * re-reading the file does not quietly undo their decision.
 */

import { MANUAL_OVERRIDE_PREFIX, type ParamEntry } from './param-file.js'

/**
 * A parameter value as AMC writes it.
 *
 * `format(value, '.6f').rstrip('0').rstrip('.')`: six decimal places, then the
 * trailing zeros and any trailing point removed. So 78.1 stays 78.1, 30000
 * stays 30000, and a calibration result keeps all six of its decimals.
 */
export function formatParamValue(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value.toFixed(6)
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '')
  // toFixed(6) on a negative zero gives "-0.000000", which trims to "-0".
  return trimmed === '-0' ? '0' : trimmed
}

export interface ParamLine {
  readonly name: string
  readonly value: number
  /** Why it is set, written after the value. */
  readonly comment?: string
  /** The operator chose this over what the sequence computes. */
  readonly manualOverride?: boolean
}

/**
 * Render one step's parameter file.
 *
 * Sorted by name, because the file is read by people and diffed by tools, and
 * a stable order is what makes both work.
 */
export function writeParamFile(lines: readonly ParamLine[]): string {
  const sorted = [...lines].sort((left, right) => left.name.localeCompare(right.name))
  const body = sorted
    .map((line) => {
      const value = `${line.name},${formatParamValue(line.value)}`
      const comment = line.manualOverride
        ? `${MANUAL_OVERRIDE_PREFIX}${line.comment ? ` ${line.comment}` : ''}`
        : (line.comment ?? '')
      // Two spaces before the hash, as AMC writes it.
      return comment.length > 0 ? `${value}  # ${comment}` : value
    })
    .join('\n')
  return sorted.length > 0 ? `${body}\n` : ''
}

/** Read a file back into the lines that would write it. */
export function linesFromEntries(entries: ReadonlyMap<string, ParamEntry>): ParamLine[] {
  return [...entries.values()].map((entry) => ({
    name: entry.name,
    value: entry.value,
    ...(entry.comment === undefined ? {} : { comment: entry.comment }),
    ...(entry.manualOverride ? { manualOverride: true } : {})
  }))
}
