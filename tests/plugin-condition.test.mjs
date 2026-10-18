import assert from 'node:assert/strict'
import test from 'node:test'

import { applyStep, parseStepFile, vehicleContext } from '../packages/amc-steps/dist/index.js'

/*
 * A step's plugin may carry an `if`. StepPlugin had the field typed from the
 * start and nothing ever evaluated it, so a tool AMC offers only to some
 * vehicles was offered to all of them. AMC's rule (get_plugin): offer it when
 * the condition holds, and hide it when the condition cannot be evaluated.
 */

const step = (plugin) =>
  parseStepFile(JSON.stringify({ steps: { '01_x.param': { plugin } } })).steps['01_x.param']

const vehicle = (version) =>
  vehicleContext(
    JSON.stringify({ Components: { 'Flight Controller': { Firmware: { Type: 'ArduCopter', Version: version } } } }),
    {}
  )

const OLDER_THAN_4_7 = "Version(vehicle_components['Flight Controller']['Firmware']['Version'].split(' ')[0]) < Version('4.7.0')"

test('a plugin with no condition always applies', () => {
  assert.equal(applyStep(step({ name: 'motor_test' }), vehicle('4.6.0')).pluginApplies, true)
})

test('a conditional plugin applies where its condition holds', () => {
  assert.equal(applyStep(step({ name: 'autotune_gain_backoff', if: OLDER_THAN_4_7 }), vehicle('4.6.2')).pluginApplies, true)
})

test('and not where it does not', () => {
  // autotune_gain_backoff is for firmware before 4.7; on 4.7 it must go.
  assert.equal(applyStep(step({ name: 'autotune_gain_backoff', if: OLDER_THAN_4_7 }), vehicle('4.7.0')).pluginApplies, false)
})

test('a condition that cannot be evaluated hides the tool rather than guessing', () => {
  // No firmware version declared: the expression has nothing to read.
  const undeclared = vehicleContext(JSON.stringify({ Components: {} }), {})
  assert.equal(applyStep(step({ name: 'autotune_gain_backoff', if: OLDER_THAN_4_7 }), undeclared).pluginApplies, false)
})
