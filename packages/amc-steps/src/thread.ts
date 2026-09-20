/**
 * Running the sequence as a sequence.
 *
 * AMC's steps are ordered, and the order is load-bearing: a step is evaluated
 * against the vehicle as the steps BEFORE it left it, not against the vehicle
 * as it is now. Step 12 reads `fc_parameters['MOT_PWM_TYPE']`, and the value
 * it should see is the one step 9 set — even though nothing has been written
 * to the flight controller yet.
 *
 * Evaluating every step against the current live parameters instead is a
 * subtly different program. It agrees wherever a step reads only the
 * components document, which is most of them, and disagrees exactly where one
 * step's output is another's input — which is where the sequence is doing its
 * most interesting work, and where a wrong answer is hardest to notice.
 *
 * So the whole run is threaded, and the steps whose answers CHANGED because of
 * it are reported: that set is the honest account of what the ordering is
 * worth on this vehicle, and it is the thing to show an operator rather than
 * quietly producing different numbers.
 */

import type { ParameterDocs } from './docs.js'
import { expressionsOf } from './load.js'
import { type ApplyOptions, type StepOutcome, type VehicleContext, applyStep, withParameters } from './run.js'
import type { ConfigurationStep, OrderedStep } from './types.js'

export interface ThreadedStep {
  readonly filename: string
  readonly outcome: StepOutcome
  /**
   * Steps whose values this one read.
   *
   * Empty for the great majority of steps. When it is not empty, this step's
   * answer depends on the ordering, which is precisely what an operator
   * comparing against a live readout would otherwise find inexplicable.
   */
  readonly inheritedFrom: readonly string[]
}

export interface ThreadedRun {
  readonly steps: readonly ThreadedStep[]
  /** The vehicle's parameters as the whole sequence would leave them. */
  readonly parameters: Readonly<Record<string, number>>
  /** Parameters the sequence deletes rather than sets. */
  readonly deleted: readonly string[]
  /**
   * Steps whose computed values differ from evaluating them against the
   * vehicle's current state instead. The cost of NOT threading, measured.
   */
  readonly orderDependent: readonly string[]
}

export interface ThreadOptions extends ApplyOptions {
  readonly docs?: ParameterDocs
}

/**
 * Run the whole sequence, each step seeing what the ones before it did.
 */
export function runThreaded(
  sequence: readonly OrderedStep[],
  vehicle: VehicleContext,
  parameters: Readonly<Record<string, number>>,
  options: ThreadOptions = {}
): ThreadedRun {
  // Who last set each parameter, so a step that inherits a value can say where
  // it came from. A bare "this differs" is not actionable; a step number is.
  const setBy = new Map<string, string>()
  const live = { ...parameters }
  const deleted = new Set<string>()
  const steps: ThreadedStep[] = []
  const orderDependent: string[] = []

  for (const { filename, step } of sequence) {
    const threadedContext = withParameters(vehicle, live)
    const outcome = applyStep(step, threadedContext, options)
    const reads = parametersRead(step)

    // What this step READ that an earlier one had already changed -- not what
    // it set. Reading is the whole mechanism: the first version of this
    // compared the parameters a step wrote against those earlier steps wrote,
    // and reported nothing at all for the one case that matters, a step whose
    // input another step produced.
    const inherited = new Set<string>()
    for (const name of reads) {
      const previous = setBy.get(name)
      if (previous !== undefined) inherited.add(previous)
    }

    // The same step against the vehicle as it is now; any disagreement is the
    // ordering doing real work. Only asked when the step reads a parameter an
    // earlier one already set -- a step that reads none cannot depend on the
    // order, and this doubles the evaluation cost of the whole sequence, which
    // the tab re-runs on every keystroke in the declaration form.
    if (inherited.size > 0) {
      const unthreaded = applyStep(step, withParameters(vehicle, parameters), options)
      if (differs(outcome, unthreaded)) orderDependent.push(filename)
    }

    for (const change of outcome.changes) {
      live[change.parameter] = change.value
      deleted.delete(change.parameter)
      setBy.set(change.parameter, filename)
    }
    for (const removal of outcome.deletions) {
      delete live[removal]
      deleted.add(removal)
      setBy.set(removal, filename)
    }

    steps.push({ filename, outcome, inheritedFrom: [...inherited] })
  }

  return { steps, parameters: live, deleted: [...deleted], orderDependent }
}

/**
 * The parameters a step's expressions read, by name.
 *
 * Read from the expression TEXT rather than by instrumenting the evaluator,
 * which is exact for the form AMC actually uses: every parameter read in every
 * sequence is written `fc_parameters['NAME']`. The bare `fc_parameters` that
 * appears far more often is a membership test (`'X' in fc_parameters`) and
 * names nothing, so there is nothing there to miss.
 */
function parametersRead(step: ConfigurationStep): Set<string> {
  const names = new Set<string>()
  for (const expression of expressionsOf(step)) {
    for (const match of expression.matchAll(/fc_parameters\[\s*['"]([^'"]+)['"]\s*\]/g)) {
      names.add(match[1] as string)
    }
  }
  return names
}

/** Whether two runs of the same step would set different values. */
function differs(a: StepOutcome, b: StepOutcome): boolean {
  if (a.changes.length !== b.changes.length) return true
  const other = new Map(b.changes.map((c) => [c.parameter, c.value]))
  for (const change of a.changes) {
    const value = other.get(change.parameter)
    // An absent parameter and a different value are the same kind of
    // disagreement here: the step would write something else.
    if (value === undefined || value !== change.value) return true
  }
  return false
}
