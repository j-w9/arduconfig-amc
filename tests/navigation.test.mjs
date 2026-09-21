// Moving through the sequence without stopping at what does not apply.
//
// Not every step is for every vehicle, and on a 63-step sequence a dozen may
// be about a feature this aircraft does not have.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  isStepOptional,
  mandatoryPercent,
  nextRequiredStep,
  orderSteps,
  parseStepFile,
  previousRequiredStep
} from '../packages/amc-steps/dist/index.js'

const sequence = orderSteps(
  parseStepFile(
    readFileSync(fileURLToPath(new URL('../steps/configuration_steps_ArduCopter.json', import.meta.url)), 'utf8')
  )
)

test('the percentage comes from the text the sequence maintains', () => {
  assert.equal(mandatoryPercent({ mandatory_text: '80% mandatory (20% optional)' }), 80)
  assert.equal(mandatoryPercent({ mandatory_text: '0% mandatory (100% optional)' }), 0)
})

test('a step that says nothing is NOT treated as optional', () => {
  // Silence is not "skip me". Treating it as zero would step over work nobody
  // meant to skip.
  assert.equal(mandatoryPercent({}), undefined)
  assert.equal(isStepOptional({}), false)
  assert.equal(isStepOptional({ mandatory_text: 'mostly optional' }), false)
})

test("AMC's threshold is the one used", () => {
  assert.equal(isStepOptional({ mandatory_text: '20% mandatory (80% optional)' }), true)
  assert.equal(isStepOptional({ mandatory_text: '21% mandatory (79% optional)' }), false)
})

test('the real sequence has both kinds, so skipping means something', () => {
  const optional = sequence.filter((entry) => isStepOptional(entry.step))
  assert.ok(optional.length > 0, 'no step in the sequence is optional — skipping would be a no-op')
  assert.ok(optional.length < sequence.length, 'every step is optional, which cannot be right')
})

test('next lands on a step worth stopping at', () => {
  let at = nextRequiredStep(sequence, undefined)
  let visited = 0
  while (at !== undefined) {
    const entry = sequence.find((s) => s.filename === at)
    assert.ok(entry, `${at} is not in the sequence`)
    assert.equal(isStepOptional(entry.step), false, `${at} is optional and should have been skipped`)
    visited += 1
    at = nextRequiredStep(sequence, at)
  }
  assert.ok(visited > 5, `only ${visited} required steps reached`)
})

test('the end of the sequence is the end, not a wrap to the start', () => {
  // Arriving back at step one because you pressed "next" once too often is a
  // worse answer than being told there is nothing after this.
  const last = [...sequence].reverse().find((entry) => !isStepOptional(entry.step))
  assert.equal(nextRequiredStep(sequence, last.filename), undefined)
  const first = sequence.find((entry) => !isStepOptional(entry.step))
  assert.equal(previousRequiredStep(sequence, first.filename), undefined)
})

test('next and previous are inverses across the required steps', () => {
  const first = nextRequiredStep(sequence, undefined)
  const second = nextRequiredStep(sequence, first)
  assert.equal(previousRequiredStep(sequence, second), first)
})

test('a name this sequence does not have starts from the beginning', () => {
  // A directory written for another vehicle, or a step since removed.
  assert.equal(
    nextRequiredStep(sequence, '99_from_another_vehicle.param'),
    nextRequiredStep(sequence, undefined)
  )
})
