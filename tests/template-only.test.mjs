// What a step's directory usually holds that the sequence never decides.
//
// AMC seeds a directory by copying a template's .param files; this fork
// computes from the directives alone. So 69 of the 662 parameters in AMC's own
// empty_4.6.x ArduCopter directory are ours and the rest simply are not there.
// Copying the values would be wrong — GPS_POS1_X is one aircraft's antenna
// offset — but the QUESTION carries across, and asking it beats silence.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  COMMON_SHARE,
  answerableFromVehicle,
  templateOnlyParameters
} from '../packages/amc-steps/dist/index.js'

const table = JSON.parse(
  readFileSync(fileURLToPath(new URL('../steps/template-only.json', import.meta.url)), 'utf8')
)

test('a step names what AMC\'s templates set and the sequence does not', () => {
  const telemetry = templateOnlyParameters(table, 'ArduCopter', '08_telemetry.param')
  const names = telemetry.map((entry) => entry.parameter)

  // The sequence computes nothing at all for this step; AMC's templates set
  // the serial port's baud rate and flow control, which is most of the job.
  assert.ok(names.includes('BRD_SER1_RTSCTS'))
  assert.ok(names.includes('SERIAL1_BAUD'))
})

test('the near-universal ones come first, because the count is the evidence', () => {
  const telemetry = templateOnlyParameters(table, 'ArduCopter', '08_telemetry.param')
  for (let i = 1; i < telemetry.length; i += 1) {
    assert.ok(telemetry[i - 1].templates >= telemetry[i].templates)
  }
  assert.ok(telemetry[0].share > 0.5, 'the first one should be set by most templates')
})

test('one aircraft\'s quirk is not presented as part of the step', () => {
  // SERIAL4_BAUD is set by a single ArduCopter template. That is that
  // builder's own business, not a question this step asks everyone.
  const shown = templateOnlyParameters(table, 'ArduCopter', '08_telemetry.param')
  assert.ok(!shown.some((entry) => entry.parameter === 'SERIAL4_BAUD'))

  // It is still in the table — the threshold is a presentation choice, not a
  // claim that the parameter does not exist.
  const everything = templateOnlyParameters(table, 'ArduCopter', '08_telemetry.param', {
    minimumShare: 0
  })
  assert.ok(everything.some((entry) => entry.parameter === 'SERIAL4_BAUD'))
})

test('a parameter the sequence DOES decide is never listed as missing', () => {
  // The whole point is to name what is absent. Listing something the step
  // already sets would send the operator to fix a thing that is not wrong.
  const receiver = templateOnlyParameters(table, 'ArduCopter', '06_remote_controller_receiver.param', {
    minimumShare: 0
  })
  const names = receiver.map((entry) => entry.parameter)
  // Both are directives of that step — RC_PROTOCOLS derived, FLTMODE_CH guarded.
  assert.ok(!names.includes('RC_PROTOCOLS'))
  assert.ok(!names.includes('FLTMODE_CH'))
})

test('the vehicle can answer most of them, and that is the honest way to', () => {
  const telemetry = templateOnlyParameters(table, 'ArduCopter', '08_telemetry.param')
  const answered = answerableFromVehicle(telemetry, { SERIAL1_BAUD: 115, BRD_SER1_RTSCTS: 2 })
  assert.deepEqual(
    [...answered].sort((a, b) => a.parameter.localeCompare(b.parameter)),
    [
      { parameter: 'BRD_SER1_RTSCTS', value: 2 },
      { parameter: 'SERIAL1_BAUD', value: 115 }
    ]
  )
})

test('a vehicle that has none of them answers none', () => {
  const telemetry = templateOnlyParameters(table, 'ArduCopter', '08_telemetry.param')
  assert.deepEqual(answerableFromVehicle(telemetry, {}), [])
})

test('an unknown vehicle or step gets nothing, rather than a guess', () => {
  assert.deepEqual(templateOnlyParameters(table, 'ArduSubmarine', '08_telemetry.param'), [])
  assert.deepEqual(templateOnlyParameters(table, 'ArduCopter', '99_invented.param'), [])
})

test('every sequence AMC ships is covered', () => {
  // Otherwise a vehicle silently gets no help at all.
  for (const vehicle of ['ArduCopter', 'ArduPlane', 'Heli', 'Rover']) {
    assert.ok(table[vehicle], `${vehicle} missing from the table`)
    assert.ok(table[vehicle].templates > 0, `${vehicle} has no templates`)
    assert.ok(Object.keys(table[vehicle].steps).length > 10, `${vehicle} covers too few steps`)
  }
})

test('the threshold is what it claims to be', () => {
  assert.ok(COMMON_SHARE > 0 && COMMON_SHARE < 1)
  const strict = templateOnlyParameters(table, 'ArduCopter', '08_telemetry.param', { minimumShare: 0.9 })
  const loose = templateOnlyParameters(table, 'ArduCopter', '08_telemetry.param', { minimumShare: 0 })
  assert.ok(strict.length < loose.length)
})
