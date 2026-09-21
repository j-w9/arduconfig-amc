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

/**
 * A parameter file with ArduPilot's documentation written above each value.
 *
 * AMC can annotate the files it writes, and the reason is the method's: a
 * directory is something an operator opens months later, or hands to someone
 * who did not configure the vehicle. `ATC_RAT_RLL_P,0.135` means nothing on
 * its own; with its name, its range and its units above it, the file explains
 * itself without ArduPilot's wiki open in another window.
 *
 * The annotation is a comment block, so an annotated file still parses as an
 * ordinary `.param` file — which is what lets `readVehicleProject` read a
 * directory back whether or not it was annotated.
 */
export function annotateParamFile(text: string, docs: AnnotationDocs): string {
  const out: string[] = []
  let first = true

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      if (line.length > 0) out.push(rawLine)
      continue
    }
    const name = /^([^,\s]+)/.exec(line)?.[1]
    const doc = name ? docs(name) : undefined
    if (doc) {
      // A blank line between entries, but not above the first: a file that
      // opens with one looks like it lost something.
      if (!first) out.push('')
      for (const comment of annotationLines(doc)) out.push(`# ${comment}`)
    }
    out.push(rawLine)
    first = false
  }

  return out.length > 0 ? `${out.join('\n')}\n` : ''
}

/** What annotation needs from the parameter documentation. */
export type AnnotationDocs = (parameter: string) => AnnotationDoc | undefined

export interface AnnotationDoc {
  readonly label?: string
  readonly description?: string
  readonly units?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly options?: readonly { readonly value: number; readonly label: string }[]
  readonly rebootRequired?: boolean
}

function annotationLines(doc: AnnotationDoc): string[] {
  const lines: string[] = []
  if (doc.label) lines.push(doc.label)
  if (doc.description && doc.description !== doc.label) lines.push(doc.description)

  const facts: string[] = []
  if (doc.minimum !== undefined && doc.maximum !== undefined) {
    facts.push(`Range: ${doc.minimum} to ${doc.maximum}`)
  }
  if (doc.units) facts.push(`Units: ${doc.units}`)
  // Worth its own line rather than buried: a value that does nothing until
  // the vehicle restarts is the commonest way a change looks like it failed.
  if (doc.rebootRequired) facts.push('Reboot required')
  if (facts.length > 0) lines.push(facts.join(' · '))

  if (doc.options && doc.options.length > 0) {
    // Capped, because a bitmask parameter can carry dozens and the file is
    // meant to be readable rather than complete.
    const shown = doc.options.slice(0, 12).map((option) => `${option.value}: ${option.label}`)
    if (doc.options.length > shown.length) shown.push(`… ${doc.options.length - shown.length} more`)
    lines.push(`Values: ${shown.join(', ')}`)
  }
  return lines
}
