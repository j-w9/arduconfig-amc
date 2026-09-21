/**
 * Saying what a parameter value means, not just what it is.
 *
 * The sequence sets `LOG_BITMASK` to 176126 and `MOT_PWM_TYPE` to 6. Shown as
 * those numbers, the operator cannot tell what is about to happen to their
 * aircraft, which defeats the point of a method whose whole claim is that
 * every value comes with a reason. AMC's table renders the documented choice
 * and decomposes a bitmask into its named bits; ArduPilot's own metadata is
 * already here to do the same.
 *
 * Deliberately returns `undefined` rather than a guess when the documentation
 * does not cover the value: a number with no explanation is honest, and a
 * wrong explanation of a logging mask is worse than none.
 */

import type { ParameterDocs } from './docs.js'

export interface ExplainedValue {
  /** A short label, e.g. `DShot300` or `3 of 32 bits`. */
  readonly summary: string
  /** The named bits a bitmask value sets, in bit order. Empty for a choice. */
  readonly bits: readonly string[]
  readonly kind: 'choice' | 'bitmask'
}

/**
 * What a value means, according to ArduPilot's parameter documentation.
 *
 * Bitmask options are keyed by BIT INDEX, choices by the value itself -- the
 * two look identical in the metadata and mean different things, so the
 * `bitmask` flag decides which reading applies.
 */
export function explainValue(
  parameter: string,
  value: number,
  docs: ParameterDocs | undefined
): ExplainedValue | undefined {
  const doc = docs?.(parameter)
  if (!doc?.options || doc.options.length === 0) return undefined

  if (doc.bitmask) return explainBitmask(value, doc.options)

  const choice = doc.options.find((option) => option.value === value)
  return choice ? { summary: choice.label, bits: [], kind: 'choice' } : undefined
}

function explainBitmask(
  value: number,
  options: readonly { readonly value: number; readonly label: string }[]
): ExplainedValue | undefined {
  // Only a non-negative whole number is a mask. A negative or fractional value
  // is the sequence meaning something else by the parameter, and decomposing
  // it would invent bits that are not there.
  if (!Number.isInteger(value) || value < 0) return undefined
  // Beyond 2^31 the bitwise operators wrap, so the decomposition would be
  // wrong rather than merely incomplete.
  if (value > 0x7fffffff) return undefined

  const byBit = new Map(options.map((option) => [option.value, option.label]))
  const bits: string[] = []
  let unnamed = 0
  for (let bit = 0; bit < 31; bit += 1) {
    if ((value & (1 << bit)) === 0) continue
    const label = byBit.get(bit)
    if (label === undefined) unnamed += 1
    else bits.push(label)
  }

  if (value === 0) return { summary: 'nothing set', bits: [], kind: 'bitmask' }
  if (bits.length === 0 && unnamed > 0) return undefined

  const total = bits.length + unnamed
  const summary =
    unnamed > 0
      ? `${bits.join(', ')}, and ${unnamed} more`
      : total <= 3
        ? bits.join(', ')
        : `${bits.length} of ${options.length}: ${bits.slice(0, 2).join(', ')}…`

  return { summary, bits, kind: 'bitmask' }
}
