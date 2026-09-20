/**
 * Checking a flight log for the messages a step should have produced.
 *
 * Several steps configure something whose only proof is in the log: ESC
 * telemetry is either arriving or it is not, and the way to tell is whether
 * the aircraft wrote any `ESC` messages on its last flight. The sequence says
 * which messages each step depends on (`related_bin_messages`), marking some
 * required and some merely useful.
 *
 * The step files already list them; this answers the question they raise.
 * Listing "this step should produce ESC messages" and leaving the operator to
 * go and look is most of a feature — the log is right there, and the app
 * already parses it.
 */

import type { ConfigurationStep } from './types.js'

export interface LogMessageStatus {
  /** The message name as it appears in the log, e.g. `ESC`. */
  readonly id: string
  /** What the sequence calls it, e.g. "ESC telemetry". */
  readonly name: string
  /** Whether the step depends on it, as opposed to merely liking it. */
  readonly required: boolean
  readonly count: number
  readonly present: boolean
}

export interface StepLogCheck {
  readonly messages: readonly LogMessageStatus[]
  /** Required messages the log does not contain. */
  readonly missingRequired: readonly string[]
  /**
   * Whether the step's evidence is complete.
   *
   * Only about REQUIRED messages: an optional one absent is a log that could
   * tell you more, not a step that did not work.
   */
  readonly satisfied: boolean
}

/**
 * Check one step's messages against a log's message counts.
 *
 * Takes counts rather than a parsed log so the caller can reuse one parse
 * across all 63 steps, and so this stays testable without a `.bin` file.
 */
export function checkStepLogMessages(
  step: ConfigurationStep,
  counts: ReadonlyMap<string, number>
): StepLogCheck {
  const messages: LogMessageStatus[] = []
  const missingRequired: string[] = []

  for (const [id, message] of Object.entries(step.related_bin_messages ?? {})) {
    const count = countWithVariants(counts, id)
    const present = count > 0
    messages.push({ id, name: message.name, required: message.required, count, present })
    if (message.required && !present) missingRequired.push(id)
  }

  return { messages, missingRequired, satisfied: missingRequired.length === 0 }
}

/**
 * The log's own name for a message, when the vehicle wrote it under a variant.
 *
 * ArduPilot numbers repeated sensors -- `IMU`, `IMU2`, `IMU3` -- while the
 * sequence names only the base. A vehicle that logged only IMU2 and IMU3 has
 * IMU data, and reporting "IMU missing" for it would be wrong.
 */
export function countWithVariants(counts: ReadonlyMap<string, number>, id: string): number {
  let total = counts.get(id) ?? 0
  for (const [name, count] of counts) {
    if (name !== id && name.startsWith(id) && /^\d+$/.test(name.slice(id.length))) total += count
  }
  return total
}
