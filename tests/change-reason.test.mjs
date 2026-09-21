// A change reason, which is usually prose and occasionally an expression.
//
// Seven directives across the four sequences pick their wording from the
// vehicle — "Use throttle-based dynamic notch filter" or "Use ESC telemetry
// RPM", depending on what the ESC reports. Writing the raw Python source into
// the file instead produces a directory whose explanations are unreadable,
// which is the one thing the method exists to get right.
//
// The bug this covers was hidden by a test asserting /throttle-based/ against
// the comment: the unevaluated source CONTAINS that phrase, so the assertion
// passed while the file held a line of Python. These assert the whole string.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  applyStep,
  orderSteps,
  parseParamFile,
  parseStepFile,
  vehicleContext,
  vehicleFiles
} from '../packages/amc-steps/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const templates = root + 'vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/'

function sequence(vehicle) {
  return orderSteps(
    parseStepFile(readFileSync(`${root}steps/configuration_steps_${vehicle}.json`, 'utf8'))
  )
}

function filesFor(vehicle, template) {
  const dir = `${templates}${vehicle}/${template}`
  const context = vehicleContext(readFileSync(dir + '/vehicle_components.json', 'utf8'), {})
  return vehicleFiles(sequence(vehicle), context, {})
}

test('a conditional reason is evaluated, not copied in as source', () => {
  const files = filesFor('ArduCopter', 'empty_4.6.x')
  const notch = parseParamFile(
    files.find((file) => file.filename === '21_motor_notch_filter_setup.param').text
  ).get('INS_HNTCH_MODE')

  // The whole string, not a substring of the Python that produces it.
  assert.equal(notch.comment, 'Use throttle-based dynamic notch filter to reduce propeller noise')
  assert.doesNotMatch(notch.comment, /vehicle_components|else/)
})

test('the branch follows the vehicle, which is the point of it being an expression', () => {
  // The empty template declares no ESC telemetry, so the throttle-based
  // wording is correct there. A vehicle that HAS it takes the other branch.
  const withTelemetry = vehicleContext(
    JSON.stringify({
      Components: { ESC: { 'ESC->FC Telemetry': { Protocol: 'DShot' }, 'FC->ESC Connection': { Protocol: 'DShot600', Type: 'Main Out' } } }
    }),
    {}
  )
  const step = sequence('ArduCopter').find(
    (entry) => entry.filename === '21_motor_notch_filter_setup.param'
  )
  const change = applyStep(step.step, withTelemetry, {}).changes.find(
    (entry) => entry.parameter === 'INS_HNTCH_MODE'
  )
  assert.match(change.reason, /ESC telemetry RPM/)
  assert.doesNotMatch(change.reason, /throttle-based/)
})

test('plain prose is left exactly as it is', () => {
  // 516 of the 523 reasons are literal text and are not valid Python at all.
  // Running them through the evaluator would be 516 failures to swallow.
  const step = sequence('ArduCopter').find(
    (entry) => entry.filename === '05_board_orientation.param'
  )
  for (const change of applyStep(step.step, vehicleContext(JSON.stringify({ Components: {} }), {}), {}).changes) {
    if (change.reason === undefined) continue
    assert.doesNotMatch(change.reason, /^\s*'/, `${change.parameter} reads as source, not prose`)
  }
})

test('no reason anywhere in any sequence survives as Python source', () => {
  // The audit this bug deserved. A reason that still contains a bracketed
  // component path is source that was never evaluated.
  const offenders = []
  for (const [vehicle, template] of [
    ['ArduCopter', 'empty_4.6.x'],
    ['ArduPlane', 'empty_4.7.x']
  ]) {
    for (const file of filesFor(vehicle, template)) {
      for (const [name, line] of parseParamFile(file.text)) {
        if (line.comment && /vehicle_components\[|fc_parameters\[/.test(line.comment)) {
          offenders.push(`${vehicle}/${file.filename} ${name}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `${offenders.length} reasons were written as unevaluated source`)
})

test('a reason that cannot be evaluated keeps its text rather than vanishing', () => {
  // AMC falls back to the raw string. Losing the explanation entirely would be
  // worse than an awkward one.
  const step = {
    forced_parameters: {
      A_PARAM: {
        'New Value': '1',
        'Change Reason': "undeclared_name if missing_thing else 'other'"
      }
    }
  }
  const change = applyStep(step, vehicleContext(JSON.stringify({ Components: {} }), {}), {}).changes[0]
  assert.equal(change.reason, "undeclared_name if missing_thing else 'other'")
})
