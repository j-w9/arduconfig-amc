// What a configured vehicle ended up with.
//
// AMC closes a configuration by categorising every parameter that differs from
// firmware default. The categories are the point: they separate what somebody
// chose from what the vehicle wrote about itself. A calibration result is not a
// decision, and neither is a read-only value or the aircraft's identity.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ID_PARAMETER_NAMES, parameterDocsFrom, summarize } from '../packages/amc-steps/dist/index.js'

const docs = parameterDocsFrom({
  COMPASS_OFS_X: { calibration: true },
  INS_ACCOFFS_X: { calibration: true },
  STAT_BOOTCNT: { readOnly: true },
  ATC_RAT_RLL_P: {},
  SYSID_THISMAV: {}
})

const defaults = new Map([
  ['COMPASS_OFS_X', 0],
  ['INS_ACCOFFS_X', 0],
  ['STAT_BOOTCNT', 0],
  ['ATC_RAT_RLL_P', 0.135],
  ['SYSID_THISMAV', 1],
  ['MOT_SPIN_MIN', 0.15]
])

test('only parameters that differ from default are summarised', () => {
  const summary = summarize(
    { ATC_RAT_RLL_P: 0.2, MOT_SPIN_MIN: 0.15 },
    defaults,
    docs
  )
  assert.deepEqual(summary.changed.map((e) => e.parameter), ['ATC_RAT_RLL_P'])
  // MOT_SPIN_MIN sits at its default, so it is compared and then left out.
  assert.equal(summary.compared, 2)
})

test('a calibration result is not counted as a decision', () => {
  const summary = summarize({ COMPASS_OFS_X: 42, ATC_RAT_RLL_P: 0.2 }, defaults, docs)
  assert.deepEqual(summary.calibration.map((e) => e.parameter), ['COMPASS_OFS_X'])
  assert.deepEqual(summary.chosen.map((e) => e.parameter), ['ATC_RAT_RLL_P'])
})

test('what the firmware wrote about itself is kept apart', () => {
  const summary = summarize({ STAT_BOOTCNT: 97 }, defaults, docs)
  assert.deepEqual(summary.readOnly.map((e) => e.parameter), ['STAT_BOOTCNT'])
  assert.deepEqual(summary.chosen, [])
})

test("the vehicle's identity is its own category", () => {
  // Ordinary writable parameters that happen to say which aircraft this is, so
  // sharing a configuration means deciding about them deliberately.
  const summary = summarize({ SYSID_THISMAV: 7 }, defaults, docs)
  assert.deepEqual(summary.identity.map((e) => e.parameter), ['SYSID_THISMAV'])
  assert.ok(ID_PARAMETER_NAMES.has('SYSID_THISMAV'))
})

test('every changed parameter lands in exactly one category', () => {
  const summary = summarize(
    { COMPASS_OFS_X: 42, STAT_BOOTCNT: 97, SYSID_THISMAV: 7, ATC_RAT_RLL_P: 0.2 },
    defaults,
    docs
  )
  const total = summary.readOnly.length + summary.calibration.length + summary.identity.length + summary.chosen.length
  assert.equal(total, summary.changed.length)
  assert.equal(summary.changed.length, 4)
})

test('a value within tolerance of its default has not changed', () => {
  // Parameters come back as 32-bit floats; equality would report noise as work.
  const summary = summarize({ ATC_RAT_RLL_P: 0.135000001 }, defaults, docs)
  assert.deepEqual(summary.changed, [])
})

test('a parameter with no known default is not compared at all', () => {
  const summary = summarize({ SOMETHING_NEW: 5 }, defaults, docs)
  assert.equal(summary.compared, 0)
  assert.deepEqual(summary.changed, [])
})

test('without defaults there is nothing to summarise', () => {
  assert.deepEqual(summarize({ ATC_RAT_RLL_P: 0.2 }, undefined, docs).changed, [])
})

test('it says when the documentation cannot support the categories', () => {
  // Without @ReadOnly and @Calibration everything lands in "chosen", which
  // would quietly overstate how much was decided. The caller is told.
  const bare = parameterDocsFrom({ COMPASS_OFS_X: { label: 'x' } })
  const summary = summarize({ COMPASS_OFS_X: 42 }, defaults, bare)
  assert.equal(summary.categoriesAvailable, false)
  assert.deepEqual(summary.chosen.map((e) => e.parameter), ['COMPASS_OFS_X'])

  const flagged = summarize({ COMPASS_OFS_X: 42 }, defaults, docs)
  assert.equal(flagged.categoriesAvailable, true)
})
