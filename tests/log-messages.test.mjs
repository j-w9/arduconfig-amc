// Checking a flight log for the messages a step should have produced.
//
// Several steps configure something whose only proof is in the log: ESC
// telemetry is either arriving or it is not. The step files already say which
// messages each step depends on; this answers the question they raise.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  checkStepLogMessages,
  countWithVariants,
  orderSteps,
  parseStepFile
} from '../packages/amc-steps/dist/index.js'

const sequence = orderSteps(
  parseStepFile(
    readFileSync(fileURLToPath(new URL('../steps/configuration_steps_ArduCopter.json', import.meta.url)), 'utf8')
  )
)
const stepFor = (filename) => sequence.find((entry) => entry.filename === filename).step

test('a step whose required messages are all present is satisfied', () => {
  const check = checkStepLogMessages(
    stepFor('09_esc_telemetry.param'),
    new Map([['ESC', 1200], ['ESCX', 40]])
  )
  assert.equal(check.satisfied, true)
  assert.deepEqual(check.missingRequired, [])
  // The optional one that is absent is still listed, with a count of zero:
  // "the log could tell you more" is worth saying.
  const edt2 = check.messages.find((m) => m.id === 'EDT2')
  assert.equal(edt2.present, false)
  assert.equal(edt2.required, false)
})

test('a missing REQUIRED message is what makes a step unsatisfied', () => {
  const check = checkStepLogMessages(stepFor('09_esc_telemetry.param'), new Map([['ESCX', 40]]))
  assert.equal(check.satisfied, false)
  assert.deepEqual(check.missingRequired, ['ESC'])
})

test('a missing OPTIONAL message does not make a step unsatisfied', () => {
  // Otherwise every step would look failed on a log with default LOG_BITMASK.
  const check = checkStepLogMessages(stepFor('10_battery_monitor.param'), new Map([['BAT', 900]]))
  assert.equal(check.satisfied, true)
  assert.deepEqual(check.missingRequired, [])
  assert.equal(check.messages.filter((m) => !m.present).length, 2)
})

test('a numbered sensor counts as its base message', () => {
  // ArduPilot logs IMU, IMU2, IMU3 for the three sensors while the sequence
  // names only IMU. A vehicle that logged IMU2 and IMU3 has IMU data, and
  // reporting it missing would be wrong.
  const counts = new Map([['IMU2', 500], ['IMU3', 500]])
  assert.equal(countWithVariants(counts, 'IMU'), 1000)
  const check = checkStepLogMessages(stepFor('21_motor_notch_filter_setup.param'), counts)
  assert.ok(!check.missingRequired.includes('IMU'), check.missingRequired.join(', '))
})

test('a message that merely starts with the same letters is not a variant', () => {
  // ISBH and ISBD are their own messages, not "IS" numbered.
  const counts = new Map([['ISBH', 10], ['ISBD', 10]])
  assert.equal(countWithVariants(counts, 'ISB'), 0)
})

test('a step with no related messages is satisfied by any log', () => {
  const check = checkStepLogMessages(stepFor('05_board_orientation.param'), new Map())
  assert.deepEqual(check.messages, [])
  assert.equal(check.satisfied, true)
})

test('the messages the sequence names are real ArduPilot message names', () => {
  // A typo in the step data would make a step permanently unsatisfiable, and
  // it would look like the operator's logging was wrong.
  const seen = new Set()
  for (const { step } of sequence) {
    for (const id of Object.keys(step.related_bin_messages ?? {})) seen.add(id)
  }
  assert.ok(seen.size > 5, `only ${seen.size} message types across the sequence`)
  for (const id of seen) {
    // ArduPilot's names are up to four uppercase alphanumerics.
    assert.match(id, /^[A-Z][A-Z0-9]{1,3}$/, `${id} is not shaped like a log message name`)
  }
})
