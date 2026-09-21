// Parameters the operator adds to a step themselves.
//
// AMC's step files are editable: add_parameter_to_current_file puts any
// parameter into any step with the operator's own reason. That is how a
// vehicle's own settings get recorded against the step they belong to — the
// telemetry port's baud rate, the antenna offset — none of which the sequence
// decides. Telling an operator which settings a step usually needs and then
// giving them nowhere to put the answer would be worse than saying nothing.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  addableParameters,
  checkAddition,
  orderSteps,
  parseParamFile,
  parseStepFile,
  startingValue,
  vehicleContext,
  vehicleFiles
} from '../packages/amc-steps/dist/index.js'

const sequence = orderSteps(
  parseStepFile(
    readFileSync(fileURLToPath(new URL('../steps/configuration_steps_ArduCopter.json', import.meta.url)), 'utf8')
  )
)

test('a name is upper-cased before it is judged', () => {
  // Typing in lower case is a keyboard state, not a different parameter.
  assert.deepEqual(checkAddition('serial1_baud', []), { name: 'SERIAL1_BAUD' })
  assert.deepEqual(checkAddition('  Serial1_Baud  ', []), { name: 'SERIAL1_BAUD' })
})

test('a name ArduPilot could not hold is refused', () => {
  // Capital first, capitals digits and underscores, sixteen characters — the
  // limit the wire protocol imposes.
  assert.equal(checkAddition('', []).problem.kind, 'empty')
  assert.equal(checkAddition('   ', []).problem.kind, 'empty')
  assert.equal(checkAddition('1SERIAL', []).problem.kind, 'malformed')
  assert.equal(checkAddition('SERIAL-1', []).problem.kind, 'malformed')
  assert.equal(checkAddition('A'.repeat(17), []).problem.kind, 'malformed')
  // Sixteen exactly is fine.
  assert.ok('name' in checkAddition('A'.repeat(16), []))
})

test('a parameter the step already has points at itself rather than refusing', () => {
  // AMC says "Parameter already exists, edit it instead" — the step is not
  // rejecting the parameter, it is saying where the value already lives.
  const result = checkAddition('LOG_BITMASK', ['LOG_BITMASK'])
  assert.equal(result.problem.kind, 'present')
  assert.equal(result.problem.name, 'LOG_BITMASK')
})

test('the names a step usually needs are offered first', () => {
  // Having just told the operator which settings this step usually has,
  // burying them in an alphabetical list of a thousand would be strange.
  const offered = addableParameters(undefined, ['ZZZ_LAST', 'AAA_FIRST', 'SERIAL1_BAUD'], {
    preferred: ['SERIAL1_BAUD']
  })
  assert.deepEqual(offered, ['SERIAL1_BAUD', 'AAA_FIRST', 'ZZZ_LAST'])
})

test('what the step already has is not offered again', () => {
  const offered = addableParameters(undefined, ['LOG_BITMASK', 'SERIAL1_BAUD'], {
    alreadyInStep: ['LOG_BITMASK']
  })
  assert.deepEqual(offered, ['SERIAL1_BAUD'])
})

test('the vehicle contributes names when there is no documentation', () => {
  // AMC falls back to the connected flight controller's own parameter list.
  const offered = addableParameters(undefined, [], { vehicleParameters: { SERIAL1_BAUD: 115 } })
  assert.deepEqual(offered, ['SERIAL1_BAUD'])
})

test('an added parameter starts at the vehicle\'s own value', () => {
  // The operator is recording what their aircraft holds, not inventing a
  // number. Zero otherwise, which is honest about being a placeholder.
  assert.equal(startingValue('SERIAL1_BAUD', { SERIAL1_BAUD: 115 }), 115)
  assert.equal(startingValue('SERIAL1_BAUD', {}), 0)
  assert.equal(startingValue('SERIAL1_BAUD', undefined), 0)
  // A vehicle that reported nonsense is not a value.
  assert.equal(startingValue('SERIAL1_BAUD', { SERIAL1_BAUD: Number.NaN }), 0)
})

test('an addition is written into the step it was added to, and nowhere else', () => {
  const context = vehicleContext(JSON.stringify({ Components: {} }), {})
  const files = vehicleFiles(sequence, context, {
    additions: new Map([
      ['08_telemetry.param', new Map([['SERIAL1_BAUD', { value: 115, reason: 'my ESP32 link' }]])]
    ])
  })

  const telemetry = files.find((file) => file.filename === '08_telemetry.param')
  const line = parseParamFile(telemetry.text).get('SERIAL1_BAUD')
  assert.equal(line.value, 115)
  assert.equal(line.comment, 'my ESP32 link')
  // Marked, because on the way back in there is otherwise no way to tell an
  // added parameter from one the sequence used to compute and no longer does.
  assert.equal(line.manualOverride, true)

  const elsewhere = files.filter(
    (file) => file.filename !== '08_telemetry.param' && parseParamFile(file.text).has('SERIAL1_BAUD')
  )
  assert.deepEqual(elsewhere.map((file) => file.filename), [])
})

test('an addition with no reason is still written', () => {
  const context = vehicleContext(JSON.stringify({ Components: {} }), {})
  const [file] = vehicleFiles(sequence, context, {
    additions: new Map([['08_telemetry.param', new Map([['SERIAL1_BAUD', { value: 115 }]])]])
  }).filter((entry) => entry.filename === '08_telemetry.param')
  assert.equal(parseParamFile(file.text).get('SERIAL1_BAUD').value, 115)
})

test('adding nothing changes nothing', () => {
  const context = vehicleContext(JSON.stringify({ Components: {} }), {})
  const without = vehicleFiles(sequence, context, {})
  const withEmpty = vehicleFiles(sequence, context, { additions: new Map() })
  assert.deepEqual(
    withEmpty.map((file) => file.text),
    without.map((file) => file.text)
  )
})
