// Moving a step's parameters onto the connection the vehicle actually uses.
//
// The sequence writes its RC receiver step against SERIAL1. If this aircraft's
// receiver is on SERIAL3, configuring SERIAL1 is worse than doing nothing: the
// port in use is left alone and the result looks like it worked.
//
// The three exception cases are the interesting part. They are AMC's, and none
// of them follows from the general rule.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { connectionRenames, planConnectionRenames } from '../packages/amc-steps/dist/index.js'

const renames = (names, connection) => Object.fromEntries(connectionRenames(names, connection))

test('a serial parameter moves to the declared serial port', () => {
  assert.deepEqual(
    renames(['SERIAL1_PROTOCOL', 'SERIAL1_BAUD'], 'SERIAL3'),
    { SERIAL1_PROTOCOL: 'SERIAL3_PROTOCOL', SERIAL1_BAUD: 'SERIAL3_BAUD' }
  )
})

test('a parameter belonging to another family is left alone', () => {
  // Only the family named by the connection moves.
  assert.deepEqual(renames(['MOT_SPIN_MIN', 'RC1_MIN'], 'SERIAL3'), {})
})

test('a multi-digit instance is handled', () => {
  assert.deepEqual(renames(['SERIAL1_PROTOCOL'], 'SERIAL10'), { SERIAL1_PROTOCOL: 'SERIAL10_PROTOCOL' })
})

test('CAN moves the CAN_P family, not the CANn one', () => {
  // The exception that does not follow from the rule: a CAN2 connection means
  // CAN_P2, because that is where the driver's parameters live.
  assert.deepEqual(renames(['CAN_P1_DRIVER', 'CAN_P1_BITRATE'], 'CAN2'), {
    CAN_P1_DRIVER: 'CAN_P2_DRIVER',
    CAN_P1_BITRATE: 'CAN_P2_BITRATE'
  })
})

test('CAN moves the CAN_D family too', () => {
  assert.deepEqual(renames(['CAN_D1_PROTOCOL'], 'CAN2'), { CAN_D1_PROTOCOL: 'CAN_D2_PROTOCOL' })
})

test('a serial connection moves BRD_SER, whose prefix says nothing about serial', () => {
  // BRD_SER1_RTSCTS belongs to SERIAL1 despite starting with BRD, so the
  // general "does the prefix contain the type" test would miss it entirely.
  assert.deepEqual(renames(['BRD_SER1_RTSCTS'], 'SERIAL3'), { BRD_SER1_RTSCTS: 'BRD_SER3_RTSCTS' })
})

test('something that is not a connection renames nothing', () => {
  // "None" is a legitimate declared value, and it is not a port.
  assert.deepEqual(renames(['SERIAL1_PROTOCOL'], 'None'), {})
  assert.deepEqual(renames(['SERIAL1_PROTOCOL'], ''), {})
  assert.deepEqual(renames(['SERIAL1_PROTOCOL'], 'SERIAL'), {})
})

test('a rename onto a name already in use is refused, not merged', () => {
  // Two parameters wanting the same name is for the operator to look at.
  const plan = planConnectionRenames(['SERIAL1_PROTOCOL', 'SERIAL3_PROTOCOL'], 'SERIAL3')
  assert.deepEqual([...plan.renames], [])
  assert.deepEqual(plan.conflicts, ['SERIAL1_PROTOCOL'])
})

test('renaming onto the same connection is a no-op', () => {
  const plan = planConnectionRenames(['SERIAL3_PROTOCOL'], 'SERIAL3')
  assert.deepEqual([...plan.renames], [])
  assert.deepEqual(plan.conflicts, [])
})

test('a plan never sends two parameters to one name', () => {
  const plan = planConnectionRenames(['SERIAL1_PROTOCOL', 'SERIAL2_PROTOCOL'], 'SERIAL3')
  const destinations = [...plan.renames.values()]
  assert.equal(new Set(destinations).size, destinations.length)
})

// And through the runner.
//
// A finding worth writing down: this rule almost never fires on our side, and
// that is not a bug. AMC renames because its step *files* are written against
// a fixed port -- the file says SERIAL1 and the aircraft uses SERIAL7. We do
// not have those files. We evaluate the step's directives, and the directives
// are already conditional on the declared connection, so the guards pick the
// right port before a rename could be needed.
//
// The rule is kept, and kept correct, because writing per-step files for a
// vehicle is still ahead of us and that is where it starts to matter.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyStep, orderSteps, parameterDocsFrom, parseStepFile, vehicleContext } from '../packages/amc-steps/dist/index.js'

const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))
const copter = orderSteps(parseStepFile(readFileSync(`${stepsDir}configuration_steps_ArduCopter.json`, 'utf8')))
const stepFor = (prefix) => copter.find((entry) => entry.filename.startsWith(prefix)).step
const docs = parameterDocsFrom(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../apps/arduconfigurator/apps/web/src/generated/param-upstream/arducopter.json', import.meta.url)),
      'utf8'
    )
  )
)

test('the runner reports what it moved, and moves nothing it should not', () => {
  // The ESC telemetry step is the one that names serial protocols at all.
  const parameters = {}
  for (let port = 1; port <= 9; port += 1) parameters[`SERIAL${port}_PROTOCOL`] = -1
  parameters.SCR_ENABLE = 0
  parameters.MOT_PWM_TYPE = 0

  const outcome = applyStep(
    stepFor('09_'),
    vehicleContext(
      JSON.stringify({
        Components: {
          ESC: {
            'ESC->FC Telemetry': { Type: 'SERIAL5', Protocol: 'BLHeli32' },
            'FC->ESC Connection': { Type: 'Main Out', Protocol: 'DShot600' }
          }
        }
      }),
      parameters
    ),
    { docs }
  )

  // Every name the step produced is one the vehicle could accept.
  const produced = [...outcome.changes.map((c) => c.parameter), ...outcome.deletions]
  for (const name of produced) {
    assert.doesNotMatch(name, /^SERIAL\d+_/, `${name} should have been decided by a guard, not left to a rename`)
  }
  // Nothing was moved, and nothing collided.
  assert.deepEqual(outcome.renamed, [])
  assert.deepEqual(outcome.renameConflicts, [])
})

test('an undeclared connection is reported, not guessed', () => {
  const outcome = applyStep(stepFor('06_'), vehicleContext('{"Components": {}}', {}), { docs })
  assert.deepEqual(outcome.renamed, [])
  assert.ok(
    outcome.failures.some((failure) => failure.parameter === '(connection)'),
    'expected the missing connection to be reported rather than assumed'
  )
})

test('a connection of None moves nothing', () => {
  const outcome = applyStep(
    stepFor('06_'),
    vehicleContext(
      JSON.stringify({ Components: { 'RC Receiver': { 'FC Connection': { Type: 'None', Protocol: 'None' } } } }),
      {}
    ),
    { docs }
  )
  assert.deepEqual(outcome.renamed, [])
})
