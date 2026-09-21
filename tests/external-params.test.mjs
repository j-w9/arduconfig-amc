// A parameter file from outside the configuration directory.
//
// AMC will open any .param file beside the vehicle so you can see what it would
// change before sending any of it, and deliberately keeps that off the project's
// books: nothing is written into the directory, no summary is regenerated.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compareExternalParams,
  defaultSelection,
  externalParamWrites
} from '../packages/amc-steps/dist/index.js'

const FILE = [
  '# a tune someone posted',
  'ATC_RAT_RLL_P,0.135  # softer',
  'ATC_RAT_RLL_I,0.135',
  'INS_LOG_BAT_MASK,1',
  'THIS_IS_NOT_REAL,7'
].join('\n')

const VEHICLE = { ATC_RAT_RLL_P: 0.2, ATC_RAT_RLL_I: 0.135, INS_LOG_BAT_MASK: 0 }

test('each line lands in one of three states against the vehicle', () => {
  const file = compareExternalParams(FILE, VEHICLE)
  const status = Object.fromEntries(file.rows.map((row) => [row.parameter, row.status]))

  assert.equal(status.ATC_RAT_RLL_P, 'differs')
  assert.equal(status.ATC_RAT_RLL_I, 'same')
  assert.equal(status.INS_LOG_BAT_MASK, 'differs')
  // The firmware on this vehicle has never heard of it, which is worth showing
  // rather than quietly dropping: it usually means the file is for another version.
  assert.equal(status.THIS_IS_NOT_REAL, 'absent')

  assert.equal(file.changedCount, 2)
  assert.equal(file.absentCount, 1)
})

test('sameness is the tolerance AMC compares with, not equality', () => {
  // is_within_tolerance(x, y, atol=1e-8, rtol=1e-4).
  const file = compareExternalParams('ATC_RAT_RLL_P,0.20001', { ATC_RAT_RLL_P: 0.2 })
  assert.equal(file.rows[0].status, 'same')
  assert.equal(file.changedCount, 0)
})

test('a Map of vehicle parameters works as well as a plain object', () => {
  const file = compareExternalParams('INS_LOG_BAT_MASK,1', new Map([['INS_LOG_BAT_MASK', 0]]))
  assert.equal(file.rows[0].status, 'differs')
  assert.equal(file.rows[0].current, 0)
})

test('the comment survives, and so does the override marker', () => {
  const file = compareExternalParams(
    ['ATC_RAT_RLL_P,0.135  # softer', 'ATC_RAT_RLL_I,0.2  # @manual_override I measured this'].join('\n'),
    VEHICLE
  )
  assert.equal(file.rows[0].comment, 'softer')
  assert.equal(file.rows[0].manualOverride, false)
  assert.equal(file.rows[1].comment, 'I measured this')
  assert.equal(file.rows[1].manualOverride, true)
})

test('the dialog opens with only the differing rows checked', () => {
  const file = compareExternalParams(FILE, VEHICLE)
  assert.deepEqual([...defaultSelection(file)].sort(), ['ATC_RAT_RLL_P', 'INS_LOG_BAT_MASK'])
})

test('a parameter the firmware does not have cannot be sent, even if it is checked', () => {
  const file = compareExternalParams(FILE, VEHICLE)
  const writes = externalParamWrites(file, new Set(['ATC_RAT_RLL_P', 'THIS_IS_NOT_REAL']))
  assert.deepEqual(writes, [{ parameter: 'ATC_RAT_RLL_P', value: 0.135 }])
})

test('an unchecked row is not sent, including one that differs', () => {
  const file = compareExternalParams(FILE, VEHICLE)
  assert.deepEqual(externalParamWrites(file, new Set()), [])
})

test('sending a row the vehicle already holds is allowed when it is asked for', () => {
  // AMC does not stop you re-sending a value; it only declines to check it for you.
  const file = compareExternalParams(FILE, VEHICLE)
  assert.deepEqual(externalParamWrites(file, new Set(['ATC_RAT_RLL_I'])), [
    { parameter: 'ATC_RAT_RLL_I', value: 0.135 }
  ])
})
