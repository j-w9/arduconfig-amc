// The summary files AMC writes beside the sequence's own.
//
// complete.param says what the METHOD decided; these say what the VEHICLE now
// holds, split by who decided it. The split is the useful part: someone
// reusing a configuration on a second airframe wants what was chosen and none
// of the calibration or identity values.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseParamFile, summaryFiles } from '../packages/amc-steps/dist/index.js'

const entry = (parameter, value) => ({ parameter, value, category: 'chosen' })

const summary = {
  readOnly: [entry('STAT_RUNTIME', 4200)],
  calibration: [entry('INS_ACCOFFS_X', 0.12), entry('COMPASS_OFS_X', 3)],
  identity: [entry('SYSID_THISMAV', 7)],
  chosen: [entry('ATC_RAT_RLL_P', 0.135), entry('LOG_BITMASK', 65535)],
  changed: [],
  compared: 0,
  categoriesAvailable: true
}

const names = (file) => [...parseParamFile(file.text).keys()]
const byName = (files, filename) => files.find((f) => f.filename === filename)

test('each category gets the file AMC names it', () => {
  // The names matter: a directory written here should be one AMC's own
  // tooling recognises.
  const files = summaryFiles(summary)
  assert.deepEqual(
    files.map((f) => f.filename).sort(),
    [
      'non-default_read-only.param',
      'non-default_writable_calibrations.param',
      'non-default_writable_ids.param',
      'non-default_writable_non-calibrations_non-ids.param',
      'reusable.param'
    ].sort()
  )
})

test('the categories do not leak into each other', () => {
  const files = summaryFiles(summary)
  assert.deepEqual(names(byName(files, 'non-default_read-only.param')), ['STAT_RUNTIME'])
  assert.deepEqual(names(byName(files, 'non-default_writable_ids.param')), ['SYSID_THISMAV'])
  assert.deepEqual(
    names(byName(files, 'non-default_writable_calibrations.param')).sort(),
    ['COMPASS_OFS_X', 'INS_ACCOFFS_X']
  )
})

test('reusable.param is what a second airframe could take as-is', () => {
  // The point of the split. This aircraft's accelerometer offsets and its
  // MAVLink id belong to IT; the tuning does not.
  const reusable = names(byName(summaryFiles(summary), 'reusable.param'))
  assert.deepEqual(reusable.sort(), ['ATC_RAT_RLL_P', 'LOG_BITMASK'])
  assert.ok(!reusable.includes('INS_ACCOFFS_X'), 'a calibration result would be wrong on another airframe')
  assert.ok(!reusable.includes('SYSID_THISMAV'), 'an identity value would collide')
})

test('an empty category is left out, not written empty', () => {
  // A file asserting "nothing was calibrated" is a claim; its absence is not.
  const files = summaryFiles({ ...summary, calibration: [], identity: [] })
  assert.equal(byName(files, 'non-default_writable_calibrations.param'), undefined)
  assert.equal(byName(files, 'non-default_writable_ids.param'), undefined)
  assert.ok(byName(files, 'non-default_read-only.param'))
})

test('a vehicle with nothing to summarise produces no files at all', () => {
  const files = summaryFiles({
    readOnly: [], calibration: [], identity: [], chosen: [], changed: [], compared: 0, categoriesAvailable: false
  })
  assert.deepEqual(files, [])
})
