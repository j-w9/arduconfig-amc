/**
 * Turning a configuration step into the parameter changes it asks for.
 *
 * Each directive is guarded by an optional `if` expression and carries either
 * an expression or a literal value. Evaluation can fail -- a guard may read a
 * component the operator has not declared yet -- and a half-applied step is
 * worse than a reported one, so failures are collected rather than thrown. The
 * caller decides whether an incomplete step may still be written.
 */

import { PyError, type PyValue, evaluate, fromJsonText, fromParameterMap } from '@arduconfig/amc-expr'
import { evaluateIn } from '@arduconfig/amc-expr'

import { type ParameterDocs, UnresolvableValueError, resolveNamedValue } from './docs.js'
import { directivesOf } from './load.js'
import { planConnectionRenames } from './rename.js'
import type { ConfigurationStep, ParameterDirective } from './types.js'
import type { DirectiveGroup } from './load.js'

/** The vehicle the sequence is being computed for. */
export interface VehicleContext {
  /** The components document, already loaded as a Python value. */
  readonly components: PyValue
  /** The parameters currently on the flight controller. */
  readonly parameters: PyValue
}

/**
 * Build a context from plain data.
 *
 * `componentsJson` is the *text* of vehicle_components.json rather than a
 * parsed object, because whether a number was written `4` or `4.0` changes the
 * result and `JSON.parse` throws that away.
 */
export function vehicleContext(componentsJson: string, parameters: Readonly<Record<string, number>>): VehicleContext {
  const document = fromJsonText(componentsJson)
  const components =
    document.t === 'dict' ? (document.v.get('Components') ?? document) : document
  return { components, parameters: fromParameterMap(parameters) }
}

/**
 * The same vehicle with a different set of parameters.
 *
 * Exists for threading the sequence: each step is evaluated against the
 * parameters the steps before it left behind, and rebuilding the whole context
 * per step would re-parse the components document 63 times to change the other
 * half of it.
 */
export function withParameters(
  vehicle: VehicleContext,
  parameters: Readonly<Record<string, number>>
): VehicleContext {
  return { components: vehicle.components, parameters: fromParameterMap(parameters) }
}

function scopeOf(vehicle: VehicleContext): Map<string, PyValue> {
  return new Map([
    ['vehicle_components', vehicle.components],
    ['fc_parameters', vehicle.parameters]
  ])
}

export interface ParameterChange {
  readonly parameter: string
  readonly value: number
  readonly group: DirectiveGroup
  /** The operator-facing justification from the step file. */
  readonly reason?: string
  /** Whether the value was computed or written literally in the step file. */
  readonly source: 'expression' | 'literal'
}

export interface SkippedDirective {
  readonly parameter: string
  readonly group: DirectiveGroup
  readonly guard: string
}

export interface FailedDirective {
  readonly parameter: string
  readonly group: DirectiveGroup
  /** The expression that raised -- the guard or the value. */
  readonly expression: string
  readonly error: string
  /** The Python exception name, so a missing component reads as `KeyError`. */
  readonly errorType: string
}

/** A parameter moved onto the connection this vehicle actually uses. */
export interface RenamedParameter {
  readonly from: string
  readonly to: string
}

export interface StepOutcome {
  /** Parameters to write, in the order the step lists them. */
  readonly changes: readonly ParameterChange[]
  /** Parameters this step removes from the vehicle's file. */
  readonly deletions: readonly string[]
  /** Directives whose guard was false, and so do not apply to this vehicle. */
  readonly skipped: readonly SkippedDirective[]
  /** Directives that could not be evaluated. A step with any of these is incomplete. */
  readonly failures: readonly FailedDirective[]
  /**
   * Parameters moved onto the connection the vehicle declared.
   *
   * The step is written against one port; this is where they actually went.
   */
  readonly renamed: readonly RenamedParameter[]
  /**
   * Renames refused because the destination was already in use.
   *
   * Reported rather than resolved: two parameters wanting one name is
   * something to look at.
   */
  readonly renameConflicts: readonly string[]
}

/**
 * Parameters are floats on the wire, so every computed value lands as a number.
 *
 * A string result is a *named* value -- the operator said 'Quad', not 1 -- and
 * is resolved against the parameter's documentation. Without documentation
 * there is no way to know what number was meant, so it fails rather than
 * guessing.
 */
function toNumber(parameter: string, value: PyValue, docs: ParameterDocs | undefined): number {
  switch (value.t) {
    case 'int':
    case 'float':
      if (!Number.isFinite(value.v)) {
        throw new PyError('ValueError', `${parameter}: evaluation produced ${value.v}`)
      }
      return value.v
    case 'bool':
      return value.v ? 1 : 0
    case 'str':
      if (!docs) {
        throw new UnresolvableValueError(parameter, value.v, 'undocumented')
      }
      return resolveNamedValue(parameter, value.v, docs)
    default:
      throw new PyError('TypeError', `parameter value must be numeric, got ${value.t}`)
  }
}

function describe(error: unknown): { error: string; errorType: string } {
  if (error instanceof PyError) return { error: error.message, errorType: error.pyType }
  if (error instanceof UnresolvableValueError) return { error: error.message, errorType: error.name }
  return { error: error instanceof Error ? error.message : String(error), errorType: 'Error' }
}

/** Evaluate a directive's guard. A directive with no guard always applies. */
function guardPasses(
  directive: ParameterDirective,
  scope: Map<string, PyValue>
): { applies: boolean; guard?: string } {
  if (directive.if === undefined) return { applies: true }
  const result = evaluateIn(directive.if, scope)
  // Python truthiness, so a guard yielding 0 or '' also declines.
  const applies =
    result.t === 'bool'
      ? result.v
      : result.t === 'int' || result.t === 'float'
        ? result.v !== 0
        : result.t === 'str'
          ? result.v.length > 0
          : result.t === 'none'
            ? false
            : true
  return { applies, guard: directive.if }
}

/**
 * Compute one step's changes for one vehicle.
 *
 * The step is not applied to anything; the outcome describes what applying it
 * would do, so it can be shown to the operator before a flight controller is
 * written to.
 */
export interface ApplyOptions {
  /**
   * ArduPilot's parameter documentation, needed by the steps that set a
   * parameter from a component's named value. Without it those directives are
   * reported as failures rather than silently dropped.
   */
  readonly docs?: ParameterDocs
}

export function applyStep(step: ConfigurationStep, vehicle: VehicleContext, options: ApplyOptions = {}): StepOutcome {
  const scope = scopeOf(vehicle)
  const changes: ParameterChange[] = []
  const deletions: string[] = []
  const skipped: SkippedDirective[] = []
  const failures: FailedDirective[] = []

  for (const { group, parameter, directive } of directivesOf(step)) {
    let applies: boolean
    try {
      const verdict = guardPasses(directive, scope)
      applies = verdict.applies
      if (!applies) {
        skipped.push({ parameter, group, guard: verdict.guard as string })
        continue
      }
    } catch (error) {
      failures.push({ parameter, group, expression: directive.if as string, ...describe(error) })
      continue
    }

    if (group === 'delete_parameters') {
      deletions.push(parameter)
      continue
    }

    const raw = directive['New Value']
    if (raw === undefined) {
      // add_parameters may take its value from the step's own .param file
      // rather than stating one; there is nothing to compute.
      continue
    }

    if (typeof raw === 'number') {
      changes.push(
        directive['Change Reason'] === undefined
          ? { parameter, value: raw, group, source: 'literal' }
          : { parameter, value: raw, group, reason: directive['Change Reason'], source: 'literal' }
      )
      continue
    }

    try {
      const value = toNumber(parameter, evaluateIn(raw, scope), options.docs)
      changes.push(
        directive['Change Reason'] === undefined
          ? { parameter, value, group, source: 'expression' }
          : { parameter, value, group, reason: directive['Change Reason'], source: 'expression' }
      )
    } catch (error) {
      failures.push({ parameter, group, expression: raw, ...describe(error) })
    }
  }

  // The step is written against one connection; the vehicle may use another.
  // Done last, over everything the step produced, so a rename cannot collide
  // with a parameter the step was about to add.
  let renamed: RenamedParameter[] = []
  let renameConflicts: readonly string[] = []
  if (step.rename_connection !== undefined) {
    try {
      const connection = evaluateIn(step.rename_connection, scope)
      if (connection.t === 'str') {
        const names = [...changes.map((change) => change.parameter), ...deletions]
        const plan = planConnectionRenames(names, connection.v)
        renamed = [...plan.renames].map(([from, to]) => ({ from, to }))
        renameConflicts = plan.conflicts
      }
    } catch (error) {
      // The connection could not be worked out -- usually a component the
      // operator has not declared. The step's parameters stay where the
      // sequence put them, and the failure is reported like any other.
      failures.push({
        parameter: '(connection)',
        group: 'forced_parameters',
        expression: step.rename_connection,
        ...describe(error)
      })
    }
  }

  const moved = new Map(renamed.map((entry) => [entry.from, entry.to]))
  return {
    changes: changes.map((change) =>
      moved.has(change.parameter) ? { ...change, parameter: moved.get(change.parameter) as string } : change
    ),
    deletions: deletions.map((name) => moved.get(name) ?? name),
    skipped,
    failures,
    renamed,
    renameConflicts
  }
}

export { evaluate }
