import assert from 'node:assert/strict'
import test from 'node:test'

import { stepsWithStaleCalibration } from '../packages/amc-steps/dist/index.js'

/*
 * AMC's find_other_steps_with_stale_calibration_values.
 *
 * Run a calibration and the flight controller holds new numbers. Every other
 * step file in the directory still records the old ones, and nothing else
 * notices: the directory becomes an account of a vehicle that no longer
 * exists, quietly, which is the one thing it is for.
 *
 * It reports and never rewrites. Editing steps the operator is not looking at
 * is not a correction.
 */

const directory = {
  '12_accelerometer.param': { INS_ACCOFFS_X: 0.01, INS_ACCOFFS_Y: -0.02 },
  '13_compass.param': { COMPASS_OFS_X: 10, INS_ACCOFFS_X: 0.01 },
  '24_throttle.param': { MOT_THST_HOVER: 0.35 }
}

test('says nothing when the directory still agrees with the vehicle', () => {
  const stale = stepsWithStaleCalibration(directory, '12_accelerometer.param', {
    INS_ACCOFFS_X: 0.01,
    INS_ACCOFFS_Y: -0.02
  })
  assert.deepEqual(stale, [])
})

test('names a step holding a value the calibration has moved on from', () => {
  // The compass step recorded INS_ACCOFFS_X when it was written; the
  // accelerometer has since been recalibrated.
  const stale = stepsWithStaleCalibration(directory, '12_accelerometer.param', {
    INS_ACCOFFS_X: 0.5
  })
  assert.deepEqual(stale, ['13_compass.param'])
})

test('never names the step the calibration is being written to', () => {
  // That file is the source of the new values, not a stale copy of the old
  // ones -- reporting it would have the operator chasing their own edit.
  const stale = stepsWithStaleCalibration(directory, '13_compass.param', { COMPASS_OFS_X: 99 })
  assert.deepEqual(stale, [])
})

test('ignores steps that never recorded the parameter at all', () => {
  // The throttle step has no opinion about accelerometer offsets, so it
  // cannot be stale about them.
  const stale = stepsWithStaleCalibration(directory, undefined, { INS_ACCOFFS_Y: 9 })
  assert.deepEqual(stale, ['12_accelerometer.param'])
})

test('uses AMC’s tolerance, not equality', () => {
  // |x - y| <= atol + rtol * |y|, atol 1e-8, rtol 1e-4. Float noise from a
  // round trip through a .param file is not a stale calibration.
  const nearly = 0.01 * (1 + 5e-5)
  assert.deepEqual(stepsWithStaleCalibration(directory, undefined, { INS_ACCOFFS_X: nearly }), [])

  const beyond = 0.01 * (1 + 5e-3)
  assert.deepEqual(stepsWithStaleCalibration(directory, undefined, { INS_ACCOFFS_X: beyond }), [
    '12_accelerometer.param',
    '13_compass.param'
  ])
})

test('names each step once however many of its values went stale', () => {
  const stale = stepsWithStaleCalibration(directory, undefined, {
    INS_ACCOFFS_X: 0.9,
    INS_ACCOFFS_Y: 0.9
  })
  assert.deepEqual(stale, ['12_accelerometer.param', '13_compass.param'])
})

test('reports without touching the directory it was given', () => {
  const before = JSON.stringify(directory)
  stepsWithStaleCalibration(directory, undefined, { INS_ACCOFFS_X: 0.9, COMPASS_OFS_X: 0 })
  assert.equal(JSON.stringify(directory), before, 'the directory must come back untouched')
})
