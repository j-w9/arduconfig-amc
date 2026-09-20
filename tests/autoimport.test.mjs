// Capturing the values already on the vehicle.
//
// A step declares patterns; any parameter matching one whose value differs from
// the firmware default belongs to that step. It is how the sequence accounts
// for work done outside it -- a calibration run, another tool's changes --
// rather than losing it.
//
// Checked against AMC's own rule in get_auto_importable_parameter_names, which
// has two details worth pinning: the patterns anchor at the start only, and the
// comparison with the default is a tolerance.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { autoImportableParameters, orderSteps, parseStepFile, withinTolerance } from '../packages/amc-steps/dist/index.js'

const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))
const copter = orderSteps(parseStepFile(readFileSync(`${stepsDir}configuration_steps_ArduCopter.json`, 'utf8')))
const stepFor = (prefix) => copter.find((entry) => entry.filename.startsWith(prefix)).step

test('captures a parameter that differs from its default', () => {
  const step = stepFor('02_') // BRD_HEAT_.*, INS_TCAL..., TCAL_ENABLED
  const captured = autoImportableParameters(
    step,
    { BRD_HEAT_TARG: 45, BRD_HEAT_P: 50, MOT_SPIN_MIN: 0.15 },
    new Map([
      ['BRD_HEAT_TARG', 45],
      ['BRD_HEAT_P', 200],
      ['MOT_SPIN_MIN', 0.1]
    ])
  )
  // BRD_HEAT_P changed and matches; BRD_HEAT_TARG matches but is default;
  // MOT_SPIN_MIN changed but belongs to no pattern here.
  assert.deepEqual(captured, ['BRD_HEAT_P'])
})

test('patterns anchor at the start, not at both ends', () => {
  // Python's re.match does not anchor the end, so TCAL_ENABLED also matches
  // TCAL_ENABLED_X. Anchoring both ends would silently drop it.
  const step = { autoimport_nondefault_regexp: ['TCAL_ENABLED'] }
  const captured = autoImportableParameters(
    step,
    { TCAL_ENABLED: 1, TCAL_ENABLED_X: 1, PRE_TCAL_ENABLED: 1 },
    new Map([
      ['TCAL_ENABLED', 0],
      ['TCAL_ENABLED_X', 0],
      ['PRE_TCAL_ENABLED', 0]
    ])
  )
  assert.deepEqual(captured, ['TCAL_ENABLED', 'TCAL_ENABLED_X'])
  // ...and it is an anchor, so a pattern does not match mid-name.
  assert.ok(!captured.includes('PRE_TCAL_ENABLED'))
})

test('a value equal to its default within tolerance is not captured', () => {
  // Parameters come back as 32-bit floats, so a value written as its default
  // does not always compare equal to it.
  assert.ok(withinTolerance(0.1, 0.10000001))
  assert.ok(!withinTolerance(0.1, 0.2))
  const step = { autoimport_nondefault_regexp: ['MOT_'] }
  const almost = autoImportableParameters(step, { MOT_SPIN_MIN: 0.15000001 }, new Map([['MOT_SPIN_MIN', 0.15]]))
  assert.deepEqual(almost, [])
})

test('a parameter with no known default is left alone', () => {
  // "Differs from default" cannot be judged without the default, and AMC skips
  // these for the same reason.
  const step = { autoimport_nondefault_regexp: ['MOT_'] }
  assert.deepEqual(autoImportableParameters(step, { MOT_NEW: 5 }, new Map()), [])
  assert.deepEqual(autoImportableParameters(step, { MOT_NEW: 5 }, undefined), [])
})

test('a step with no patterns captures nothing', () => {
  assert.deepEqual(autoImportableParameters({}, { A: 1 }, new Map([['A', 0]])), [])
})

test('a pattern this engine cannot compile captures nothing, and does not throw', () => {
  const step = { autoimport_nondefault_regexp: ['([unclosed'] }
  assert.deepEqual(autoImportableParameters(step, { A: 1 }, new Map([['A', 0]])), [])
})

test('every pattern in the real sequence compiles', () => {
  // A pattern that JavaScript cannot read would silently capture nothing, so
  // the whole corpus is checked rather than assumed.
  let patterns = 0
  for (const { filename, step } of copter) {
    for (const pattern of step.autoimport_nondefault_regexp ?? []) {
      patterns += 1
      assert.doesNotThrow(() => new RegExp(`^(?:${pattern})`), `${filename}: ${pattern}`)
    }
  }
  assert.ok(patterns > 50, `only ${patterns} patterns seen`)
})

test('the real IMU step captures a changed calibration', () => {
  const step = stepFor('03_') // the results step
  const patterns = step.autoimport_nondefault_regexp ?? []
  assert.ok(patterns.length > 0, 'the results step should capture something')
  // A calibration run leaves INS_TCAL1_* populated; that is exactly the work
  // this step exists to take account of.
  const captured = autoImportableParameters(
    step,
    { INS_TCAL1_ENABLE: 1, INS_TCAL1_TMIN: 12.5, INS_TCAL1_TMAX: 60 },
    new Map([
      ['INS_TCAL1_ENABLE', 0],
      ['INS_TCAL1_TMIN', 0],
      ['INS_TCAL1_TMAX', 0]
    ])
  )
  assert.ok(captured.length > 0, `captured nothing; patterns were ${JSON.stringify(patterns)}`)
})
