/**
 * A parameter file from outside the vehicle directory, compared with the vehicle.
 *
 * AMC lets you open any `.param` file -- one off a forum post, one saved from
 * another aircraft, a vendor's tune -- and look at it beside the flight
 * controller before deciding what to send. The distinction that matters is that
 * this is deliberately *not* project bookkeeping: `upload_external_params_workflow`
 * runs the ordinary upload with `persist_project_state=False`, so nothing is
 * written into the configuration directory and no summary is regenerated. The
 * file is a visitor, not a step.
 */

import { withinTolerance } from './autoimport.js'
import { type ParamEntry, parseParamFile } from './param-file.js'

/** How a parameter in the file stands against the vehicle. */
export type ExternalParamStatus =
  /** The vehicle already holds this value. */
  | 'same'
  /** The vehicle holds a different value. */
  | 'differs'
  /** This firmware does not have the parameter at all. */
  | 'absent'

export interface ExternalParamRow {
  readonly parameter: string
  /** The value the file asks for. */
  readonly value: number
  /** What the vehicle currently reports, when it has the parameter. */
  readonly current?: number
  /** The file's own comment, with `@manual_override` already stripped. */
  readonly comment?: string
  readonly manualOverride: boolean
  readonly status: ExternalParamStatus
}

export interface ExternalParamFile {
  readonly rows: readonly ExternalParamRow[]
  /** How many rows the vehicle would actually change on. */
  readonly changedCount: number
  /** Rows naming a parameter this firmware does not have. */
  readonly absentCount: number
}

/**
 * Read a parameter file and line it up against the vehicle's current values.
 *
 * `current` is the vehicle's parameters; leaving a name out of it means the
 * firmware does not have that parameter, which AMC shows rather than hides --
 * a file written for another firmware version is exactly the case worth seeing.
 */
export function compareExternalParams(
  text: string,
  current: ReadonlyMap<string, number> | Readonly<Record<string, number>>
): ExternalParamFile {
  const lookup =
    current instanceof Map ? current : new Map(Object.entries(current as Record<string, number>))

  const rows: ExternalParamRow[] = []
  let changedCount = 0
  let absentCount = 0

  for (const entry of parseParamFile(text).values()) {
    const row = compare(entry, lookup)
    rows.push(row)
    if (row.status === 'differs') changedCount += 1
    if (row.status === 'absent') absentCount += 1
  }

  return { rows, changedCount, absentCount }
}

function compare(entry: ParamEntry, lookup: ReadonlyMap<string, number>): ExternalParamRow {
  const current = lookup.get(entry.name)
  const status: ExternalParamStatus =
    current === undefined ? 'absent' : withinTolerance(entry.value, current) ? 'same' : 'differs'

  return {
    parameter: entry.name,
    value: entry.value,
    ...(current === undefined ? {} : { current }),
    ...(entry.comment === undefined || entry.comment.length === 0 ? {} : { comment: entry.comment }),
    manualOverride: entry.manualOverride,
    status
  }
}

/**
 * The rows AMC selects for upload by default.
 *
 * The dialog opens showing everything, but only the differing rows are worth
 * sending: a parameter the vehicle already holds costs a write and a read-back
 * to confirm nothing happened. A parameter this firmware does not have cannot
 * be sent at all.
 */
export function defaultSelection(file: ExternalParamFile): ReadonlySet<string> {
  return new Set(file.rows.filter((row) => row.status === 'differs').map((row) => row.parameter))
}

/** The parameter writes a selection amounts to, dropping anything unsendable. */
export function externalParamWrites(
  file: ExternalParamFile,
  selected: ReadonlySet<string>
): readonly { readonly parameter: string; readonly value: number }[] {
  return file.rows
    .filter((row) => row.status !== 'absent' && selected.has(row.parameter))
    .map((row) => ({ parameter: row.parameter, value: row.value }))
}
