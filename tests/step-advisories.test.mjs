// Two things AMC's step processing does that are neither a value nor an error.
//
// A derived parameter the connected firmware does not have is dropped rather
// than written, because writing it is a failure the operator then has to
// interpret. And a vehicle on an ExpressLRS link with FLTMODE_CH still on 5 is
// told so, because RC5 is the channel that link arms on.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyStep, vehicleContext } from '../packages/amc-steps/dist/index.js'

const COMPONENTS = JSON.stringify({ Components: {} })

/** A step that derives one parameter and forces another. */
const step = {
  derived_parameters: { A_DERIVED: { 'New Value': '1', 'Change Reason': 'computed' } },
  forced_parameters: { A_FORCED: { 'New Value': '2', 'Change Reason': 'required' } }
}

function run(parameters, options = {}) {
  // Dropping requires BOTH the list and the statement that it is complete:
  // absence only means "this firmware lacks it" once everything has arrived.
  return applyStep(step, vehicleContext(COMPONENTS, parameters), options)
}

test('a derived parameter the firmware does not have is dropped, and named', () => {
  const outcome = run({ A_FORCED: 0 }, { vehicleParameters: { A_FORCED: 0 }, parametersComplete: true })
  assert.deepEqual(outcome.dropped, ['A_DERIVED'])
  assert.deepEqual(outcome.changes.map((change) => change.parameter), ['A_FORCED'])
})

test('a forced parameter the firmware lacks is kept, because that is worth seeing', () => {
  // The sequence disagreeing with the build is a different thing from a
  // derived value having nowhere to go, and AMC only filters the derived ones.
  const outcome = run({ A_DERIVED: 0 }, { vehicleParameters: { A_DERIVED: 0 }, parametersComplete: true })
  assert.deepEqual(outcome.dropped, [])
  assert.ok(outcome.changes.some((change) => change.parameter === 'A_FORCED'))
})

test('with no vehicle, everything the sequence computes is kept', () => {
  // A directory built on the bench should say everything the sequence has to
  // say, not narrow itself to nothing because no vehicle answered.
  const outcome = run({})
  assert.deepEqual(outcome.dropped, [])
  assert.equal(outcome.changes.length, 2)

  // An empty parameter set is "nothing answered", not "the firmware has none".
  assert.deepEqual(run({}, { vehicleParameters: {}, parametersComplete: true }).dropped, [])
  // And a list nobody has called complete is a sync still in progress.
  assert.deepEqual(run({ A_FORCED: 0 }, { vehicleParameters: { A_FORCED: 0 } }).dropped, [])
})

test('a vehicle that has both keeps both', () => {
  const outcome = run(
    { A_DERIVED: 0, A_FORCED: 0 },
    { vehicleParameters: { A_DERIVED: 0, A_FORCED: 0 }, parametersComplete: true }
  )
  assert.deepEqual(outcome.dropped, [])
  assert.equal(outcome.changes.length, 2)
})

// The ExpressLRS advisory. AMC's ELRS_RC_OPTIONS_BITS are 9 and 13.
const elrsStep = {
  forced_parameters: { FLTMODE_CH: { 'New Value': '5', 'Change Reason': 'default' } }
}

function elrs(parameters) {
  return applyStep(elrsStep, vehicleContext(COMPONENTS, parameters), {
    vehicleParameters: parameters
  }).advisories
}

test('an ExpressLRS vehicle with the flight mode still on channel 5 is warned', () => {
  for (const bit of [9, 13]) {
    const advisories = elrs({ RC_OPTIONS: 1 << bit, FLTMODE_CH: 5 })
    assert.equal(advisories.length, 1, `bit ${bit}`)
    assert.match(advisories[0].message, /FLTMODE_CH is 5/)
  }
})

test('the same vehicle on another channel is left alone', () => {
  assert.deepEqual(elrs({ RC_OPTIONS: 1 << 9, FLTMODE_CH: 6 }), [])
})

test('a vehicle not on ExpressLRS is left alone', () => {
  // Bit 0 is some other RC option entirely.
  assert.deepEqual(elrs({ RC_OPTIONS: 1, FLTMODE_CH: 5 }), [])
})

test('a step that is not about either parameter says nothing', () => {
  // AMC only raises this while processing a step that touches RC_OPTIONS or
  // FLTMODE_CH; on every other step it would be noise repeated 63 times.
  const outcome = applyStep(step, vehicleContext(COMPONENTS, {}), {
    vehicleParameters: { RC_OPTIONS: 1 << 9, FLTMODE_CH: 5, A_DERIVED: 0, A_FORCED: 0 }
  })
  assert.deepEqual(outcome.advisories, [])
})

test('with no vehicle there is nothing to advise about', () => {
  assert.deepEqual(applyStep(elrsStep, vehicleContext(COMPONENTS, {}), {}).advisories, [])
})

test("AMC's defaults apply when the vehicle has not reported these", () => {
  // RC_OPTIONS defaults to 32 and FLTMODE_CH to 5 in AMC's check. 32 is bit 5,
  // which is not an ExpressLRS bit, so a silent vehicle gets no warning.
  assert.deepEqual(elrs({ FLTMODE_CH: 5 }), [])
  // But one that reports the ELRS bit and no FLTMODE_CH is warned, because the
  // default it would take is exactly the one that clashes.
  assert.equal(elrs({ RC_OPTIONS: 1 << 13 }).length, 1)
})

test('the advisory is judged on what the step names, not on what its guards allowed', () => {
  // AMC raises this against the step's whole .param file, which holds
  // RC_OPTIONS whether or not the directive that sets it applied. Judging on
  // the computed changes instead would mean the warning never appears: the
  // only directive naming FLTMODE_CH is guarded on a Protocol of
  // 'ExpressLRS', and neither ArduPilot's RC_PROTOCOLS documentation nor any
  // of AMC's own 25 templates ever uses that value.
  const guardedOut = {
    derived_parameters: {
      FLTMODE_CH: {
        if: "vehicle_components['RC Receiver']['FC Connection']['Protocol'] == 'ExpressLRS'",
        'New Value': '6',
        'Change Reason': 'ExpressLRS requires FLTMODE_CH != 5'
      }
    }
  }
  const outcome = applyStep(guardedOut, vehicleContext(COMPONENTS, {}), {
    vehicleParameters: { RC_OPTIONS: 1 << 9, FLTMODE_CH: 5 }
  })
  // The directive did not apply — and the advisory still fires, because the
  // vehicle's own RC_OPTIONS is what says this is an ExpressLRS link.
  assert.equal(outcome.changes.length, 0)
  assert.equal(outcome.advisories.length, 1)
})
