/**
 * Explaining a directive that could not be computed.
 *
 * The evaluator's own words are precise but they are its words, not the
 * operator's: `KeyError: 'ESC'` is correct and unhelpful. Every failure carries
 * the expression that raised, so the expression can be re-read to say which
 * part of the vehicle is missing instead.
 */

import type { ComponentPath } from './components.js'
import { pathsRead, readComponentPath } from './components.js'
import type { FailedDirective } from './run.js'

export type DiagnosisKind =
  /** A component the operator has not declared. */
  | 'undeclared-component'
  /** A component field that is declared but cannot be used, e.g. a zero diameter. */
  | 'unusable-component'
  /** A parameter this vehicle's firmware does not have. */
  | 'absent-parameter'
  /** A named value with no number behind it in the parameter documentation. */
  | 'unresolvable-value'
  | 'other'

export interface Diagnosis {
  readonly kind: DiagnosisKind
  /** Component fields to declare, for 'undeclared-component'. */
  readonly declare: readonly ComponentPath[]
  /** Component fields the expression depends on, declared or not. */
  readonly depends: readonly ComponentPath[]
  /** Parameters the expression reads that the vehicle does not report. */
  readonly parameters: readonly string[]
  /** One line, in the operator's terms. */
  readonly summary: string
}

/** `Battery > Specifications > Number of cells` */
export function describePath(path: ComponentPath): string {
  return path.join(' › ')
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`
}

/**
 * Work out what a failed directive actually needs.
 *
 * `components` is the declared vehicle, used to tell a field that was never
 * entered from one that was entered and does not work -- a propeller diameter
 * of 0 is declared, and still makes the filter-frequency steps impossible.
 */
export function diagnose(failure: FailedDirective, components: unknown): Diagnosis {
  let depends: ComponentPath[] = []
  let parameters: string[] = []
  try {
    depends = pathsRead(failure.expression, 'vehicle_components')
    parameters = pathsRead(failure.expression, 'fc_parameters')
      .map((path) => path[0])
      .filter((name): name is string => name !== undefined)
  } catch {
    // An expression that will not parse cannot be explained further; the
    // evaluator's own message is all there is.
  }

  const declare = depends.filter((path) => readComponentPath(components, path) === undefined)

  if (failure.errorType === 'UnresolvableValueError') {
    return {
      kind: 'unresolvable-value',
      declare,
      depends,
      parameters,
      summary: `${failure.parameter} cannot be set from this vehicle's declared value — ${failure.error.replace(`${failure.parameter}: `, '')}.`
    }
  }

  if (declare.length > 0) {
    return {
      kind: 'undeclared-component',
      declare,
      depends,
      parameters,
      summary: `Declare ${list(declare.map(describePath))} to set ${failure.parameter}.`
    }
  }

  // Nothing is missing from the vehicle, so a parameter it does not report is
  // the next most likely cause -- a Copter parameter on a Plane, say.
  if (failure.errorType === 'KeyError' && parameters.length > 0) {
    return {
      kind: 'absent-parameter',
      declare,
      depends,
      parameters,
      summary: `${failure.parameter} depends on ${list(parameters)}, which this vehicle does not report.`
    }
  }

  if (
    (failure.errorType === 'ZeroDivisionError' || failure.errorType === 'ValueError') &&
    depends.length > 0
  ) {
    return {
      kind: 'unusable-component',
      declare,
      depends,
      parameters,
      summary: `${failure.parameter} cannot be computed from the declared ${list(depends.map(describePath))} — check the value.`
    }
  }

  return {
    kind: 'other',
    declare,
    depends,
    parameters,
    summary: `${failure.parameter} could not be computed: ${failure.error}.`
  }
}
