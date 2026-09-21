// What a flight log says the parameters were.
//
// ArduPilot writes a PARM record per parameter at startup carrying both the
// value in force and the firmware's own Default. The defaults are the part
// that matters here: a step can only capture what the operator changed, which
// means knowing what "unchanged" is, and this tab otherwise gets that from
// MAVFTP -- a live vehicle, and the part most likely to fail.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { logHasDefaults, parametersFromLog } from '../packages/amc-steps/dist/index.js'

const parm = (Name, Value, Default) => ({
  name: 'PARM',
  Name,
  Value,
  ...(Default === undefined ? {} : { Default })
})

const log = (messages) => new Map([['PARM', messages]])

test('a log answers what the values were and what the firmware would have used', () => {
  const { values, defaults, changed } = parametersFromLog(
    log([
      parm('INS_LOG_BAT_MASK', 1, 0),
      parm('ATC_RAT_RLL_P', 0.135, 0.135),
      parm('LOG_BITMASK', 176126, 180222)
    ])
  )

  assert.equal(values.get('INS_LOG_BAT_MASK'), 1)
  assert.equal(defaults.get('INS_LOG_BAT_MASK'), 0)
  // Only what the operator actually moved away from the default.
  assert.deepEqual([...changed.keys()].sort(), ['INS_LOG_BAT_MASK', 'LOG_BITMASK'])
})

test('the first record wins, because a second one is an in-flight change', () => {
  // A parameter written twice was changed during the flight. The first is what
  // the vehicle started with, which is the configuration being read.
  const { values } = parametersFromLog(
    log([parm('ATC_RAT_RLL_P', 0.135, 0.135), parm('ATC_RAT_RLL_P', 0.09, 0.135)])
  )
  assert.equal(values.get('ATC_RAT_RLL_P'), 0.135)
})

test('a log without the Default column says so rather than inventing one', () => {
  // Older firmware writes PARM with no Default. Treating the value as the
  // default would make every parameter look untouched, and every step would
  // then capture nothing while appearing to have worked.
  const older = log([parm('ATC_RAT_RLL_P', 0.135), parm('LOG_BITMASK', 176126)])
  assert.equal(logHasDefaults(older), false)
  const { values, defaults, changed } = parametersFromLog(older)
  assert.equal(values.size, 2)
  assert.equal(defaults.size, 0)
  assert.equal(changed.size, 0)
})

test('a log with the column is recognised even when most records lack it', () => {
  const mixed = log([parm('A_PARAM', 1), parm('B_PARAM', 2, 0)])
  assert.equal(logHasDefaults(mixed), true)
})

test('a record missing a name or a value is skipped, not guessed at', () => {
  const { values } = parametersFromLog(
    log([
      { name: 'PARM', Value: 1, Default: 0 },
      { name: 'PARM', Name: '', Value: 1 },
      { name: 'PARM', Name: 'REAL_ONE', Value: 'not a number' },
      parm('GOOD_ONE', 5, 5)
    ])
  )
  assert.deepEqual([...values.keys()], ['GOOD_ONE'])
})

test('a log with no PARM records at all is empty, not an error', () => {
  const { values, defaults } = parametersFromLog(new Map([['IMU', []]]))
  assert.equal(values.size, 0)
  assert.equal(defaults.size, 0)
  assert.equal(logHasDefaults(new Map()), false)
})

test('a value differing from its default in the last bit still counts', () => {
  // Compared exactly, as AMC does: these are the same float the firmware wrote
  // twice into one record, so a tolerance would only blur a real difference.
  const { changed } = parametersFromLog(log([parm('ATC_RAT_RLL_P', 0.1350000023841858, 0.135)]))
  assert.equal(changed.size, 1)
})
