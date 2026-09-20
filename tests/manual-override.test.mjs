// The marker that lets a vehicle disagree with the sequence on purpose.
//
// `@manual_override` on a forced or derived parameter records that the operator
// chose a different value, and AMC lets the file's value win over the computed
// one. Reading it is what turns "this template contradicts the step file" from
// a suspected data bug into a decision someone made and wrote down.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { MANUAL_OVERRIDE_PREFIX, parameterValues, parseParamFile } from '../packages/amc-steps/dist/index.js'

const templates = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', import.meta.url)
)

test('a plain line is a name, a value and a reason', () => {
  const entries = parseParamFile('LOG_BITMASK,407517  # Log relevant data for PID notch filters tuning\n')
  const entry = entries.get('LOG_BITMASK')
  assert.equal(entry.value, 407517)
  assert.equal(entry.manualOverride, false)
  assert.equal(entry.comment, 'Log relevant data for PID notch filters tuning')
})

test('the marker is read, and stripped from the reason', () => {
  const entries = parseParamFile(`LOG_BITMASK,407519  # ${MANUAL_OVERRIDE_PREFIX} keeping Medium Attitude on\n`)
  const entry = entries.get('LOG_BITMASK')
  assert.equal(entry.value, 407519)
  assert.equal(entry.manualOverride, true)
  // The operator sees their own words, not the marker.
  assert.equal(entry.comment, 'keeping Medium Attitude on')
})

test('a marker with no reason after it leaves no empty comment', () => {
  const entry = parseParamFile(`FOO,1 # ${MANUAL_OVERRIDE_PREFIX}\n`).get('FOO')
  assert.equal(entry.manualOverride, true)
  assert.equal(entry.comment, undefined)
})

test('the separator may be a comma or whitespace, and blank lines are skipped', () => {
  const entries = parseParamFile('\n# a whole-line comment\nA,1\nB 2\n\nC\t3\n')
  assert.deepEqual([...entries.keys()], ['A', 'B', 'C'])
  assert.deepEqual(parameterValues(entries), { A: 1, B: 2, C: 3 })
})

test('a line that is not a parameter is ignored rather than guessed at', () => {
  const entries = parseParamFile('NOT_A_PARAM\nALSO,not-a-number\nGOOD,4\n')
  assert.deepEqual([...entries.keys()], ['GOOD'])
})

test('the real template reads as an override, not as a contradiction', () => {
  // Holybro_X500 keeps Medium Attitude logging on during PID notch tuning:
  // 407519 where the step file forces 407517. Bit 1 is the difference.
  const file = `${templates}ArduCopter/Holybro_X500/27_pid_notch_filter_logging.param`
  const entry = parseParamFile(readFileSync(file, 'utf8')).get('LOG_BITMASK')
  assert.equal(entry.value, 407519)
  assert.equal(entry.manualOverride, true)
  assert.equal((407519 ^ 407517).toString(2), '10', 'the difference should be bit 1')

  // And the template beside it, which does not override, agrees with the step.
  const plain = `${templates}ArduCopter/Holybro_X500_V2/27_pid_notch_filter_logging.param`
  const other = parseParamFile(readFileSync(plain, 'utf8')).get('LOG_BITMASK')
  assert.equal(other.value, 407517)
  assert.equal(other.manualOverride, false)
})
