/**
 * Moving through the sequence without stopping at what does not apply.
 *
 * Not every step is for every vehicle. The sequence says how mandatory each
 * one is as a percentage — "80% mandatory (20% optional)" — and a step at or
 * below 20% is one most operators skip. AMC lets you step past those, which
 * matters on a 63-step sequence where a dozen are about a feature this
 * aircraft does not have.
 *
 * The percentage is parsed from the step's own text rather than stored as a
 * number, because that text is what upstream maintains: a step whose wording
 * changes should change its answer here, not quietly keep the old one.
 */

import type { OrderedStep } from './types.js'

/** At or below this, a step is one most vehicles skip. AMC's threshold. */
export const OPTIONAL_THRESHOLD_PERCENT = 20

/**
 * How mandatory a step is, as the sequence states it.
 *
 * Undefined when the step says nothing, which is NOT the same as zero: a step
 * with no stated percentage has not been declared optional, and treating
 * silence as "skip me" would step over work nobody meant to skip.
 */
export function mandatoryPercent(step: { readonly mandatory_text?: string }): number | undefined {
  const text = step.mandatory_text
  if (typeof text !== 'string') return undefined
  const match = /^\s*(\d+)\s*%/.exec(text)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** Whether most operators would skip this step. */
export function isStepOptional(
  step: { readonly mandatory_text?: string },
  threshold = OPTIONAL_THRESHOLD_PERCENT
): boolean {
  const percent = mandatoryPercent(step)
  return percent !== undefined && percent <= threshold
}

/**
 * The next step worth stopping at, after `filename`.
 *
 * Returns undefined at the end of the sequence rather than wrapping: arriving
 * back at step one because you pressed "next" once too often is a worse
 * answer than being told there is nothing after this.
 */
export function nextRequiredStep(
  sequence: readonly OrderedStep[],
  filename: string | undefined,
  threshold = OPTIONAL_THRESHOLD_PERCENT
): string | undefined {
  const from = filename === undefined ? -1 : sequence.findIndex((entry) => entry.filename === filename)
  // A name this sequence does not have starts from the beginning rather than
  // from nowhere.
  const start = from === -1 ? 0 : from + 1
  for (let i = start; i < sequence.length; i += 1) {
    const entry = sequence[i]
    if (entry && !isStepOptional(entry.step, threshold)) return entry.filename
  }
  return undefined
}

/** The previous step worth stopping at, before `filename`. */
export function previousRequiredStep(
  sequence: readonly OrderedStep[],
  filename: string | undefined,
  threshold = OPTIONAL_THRESHOLD_PERCENT
): string | undefined {
  const from = filename === undefined ? sequence.length : sequence.findIndex((entry) => entry.filename === filename)
  const start = from === -1 ? sequence.length - 1 : from - 1
  for (let i = start; i >= 0; i -= 1) {
    const entry = sequence[i]
    if (entry && !isStepOptional(entry.step, threshold)) return entry.filename
  }
  return undefined
}
