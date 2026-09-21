/**
 * How long to wait for a flight controller to come back.
 *
 * A step that sets a boot-time parameter is not finished when the write is
 * acknowledged — it is finished when the vehicle has restarted and read it.
 * AMC reboots, waits, and reconnects as one action, which is what makes
 * working through the sequence feel continuous rather than like a series of
 * manual recoveries.
 *
 * The wait is not a fixed number. `BRD_BOOT_DELAY` holds a board off for a
 * configurable period, and a step may be the very thing that changes it — so
 * the wait is the LARGER of what the vehicle currently has and what the step
 * is about to set. Taking only the current value means reconnecting too early
 * on the reboot that lengthens the delay; taking only the staged value means
 * the same on every other reboot.
 */

/** What a board takes to boot before its own configured delay. */
const BASE_BOOT_SECONDS = 1

export interface RebootWaitInputs {
  /** `BRD_BOOT_DELAY` as the vehicle currently has it, in milliseconds. */
  readonly current?: number
  /** `BRD_BOOT_DELAY` as this step would set it, in milliseconds. */
  readonly staged?: number
}

/**
 * Seconds to wait before trying to reconnect.
 *
 * Rounded UP, as AMC does: coming back a moment late costs a moment, coming
 * back early costs a failed connection and an operator wondering whether the
 * write took.
 */
export function rebootWaitSeconds(inputs: RebootWaitInputs = {}): number {
  const values = [inputs.current, inputs.staged]
    .map((value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0))
  const delayMs = Math.max(...values, 0)
  return Math.floor(delayMs / 1000) + BASE_BOOT_SECONDS
}

/** Whether a set of changes would alter how long the next boot takes. */
export function changesBootDelay(
  changes: readonly { readonly parameter: string; readonly value: number }[]
): number | undefined {
  return changes.find((change) => change.parameter === 'BRD_BOOT_DELAY')?.value
}
