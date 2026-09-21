// What a connection's Type implies about its Protocol.
//
// The pairings come from AMC's own templates, which makes them evidence rather
// than a specification — so the contract under test is deliberately weak in
// one direction and strong in the other: the likely options must come first,
// and NOTHING may ever be removed. Twenty-nine templates cannot prove that a
// protocol nobody happened to use is invalid, and an operator who cannot find
// their own hardware in the list is worse off than one shown a long list.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  connectionGroupOf,
  escTelemetryMirror,
  orderByPairing,
  protocolsForConnection
} from '../packages/amc-steps/dist/index.js'

const pairings = JSON.parse(
  readFileSync(fileURLToPath(new URL('../steps/component-pairings.json', import.meta.url)), 'utf8')
)
// The authoritative tables, extracted from AMC's source: what a connection
// type can actually carry, as opposed to what the templates happen to show.
const tables = JSON.parse(
  readFileSync(fileURLToPath(new URL('../steps/connection-tables.json', import.meta.url)), 'utf8')
)

test('the pairings observed are the ones the templates actually show', () => {
  // A sanity check on the generator: these are real wiring facts, and if the
  // sync ever produced an empty or nonsensical map the reordering below would
  // silently become a no-op.
  assert.ok(Object.keys(pairings).length >= 5, 'too few connection groups observed')
  assert.deepEqual(pairings['ESC/FC->ESC Connection']['SERIAL1'], ['FETtecOneWire'])
  assert.deepEqual(pairings['GNSS Receiver/FC Connection']['CAN1'], ['DroneCAN'])
  // A serial GNSS is not a CAN one.
  assert.ok(!pairings['GNSS Receiver/FC Connection']['SERIAL3'].includes('DroneCAN'))
})

test('a declared type puts the protocols it is seen with first', () => {
  const options = ['Normal', 'OneShot', 'DShot600', 'FETtecOneWire']
  const { ordered, likely } = orderByPairing(
    options,
    pairings,
    'ESC/FC->ESC Connection',
    'SERIAL1'
  )
  assert.equal(ordered[0], 'FETtecOneWire', 'the evidenced protocol was not offered first')
  assert.ok(likely.has('FETtecOneWire'))
})

test('nothing is ever removed, however narrow the evidence', () => {
  // The guarantee that makes this safe to apply everywhere.
  const options = ['Normal', 'OneShot', 'DShot600', 'FETtecOneWire', 'Something_New']
  const { ordered } = orderByPairing(options, pairings, 'ESC/FC->ESC Connection', 'SERIAL1')
  assert.equal(ordered.length, options.length)
  for (const option of options) assert.ok(ordered.includes(option), `${option} was dropped`)
})

test('a value a template used but the documentation lacks is still offered', () => {
  // The templates are evidence of real vehicles; a protocol one of them used
  // is a protocol that works, documented or not.
  const { ordered } = orderByPairing(['Normal'], pairings, 'ESC/FC->ESC Connection', 'Main Out')
  assert.ok(ordered.includes('DShot600'), 'a protocol seen on a real vehicle was not offered')
})

test('an undeclared type leaves the list exactly as it was', () => {
  const options = ['Normal', 'DShot600']
  assert.equal(orderByPairing(options, pairings, 'ESC/FC->ESC Connection', undefined).ordered, options)
  assert.equal(orderByPairing(options, pairings, undefined, 'Main Out').ordered, options)
  // An unknown type is not evidence of anything either.
  assert.equal(orderByPairing(options, pairings, 'ESC/FC->ESC Connection', 'SERIAL9').ordered, options)
})

test('only a connection field has a counterpart to be constrained by', () => {
  assert.equal(connectionGroupOf(['ESC', 'FC->ESC Connection', 'Protocol']), 'ESC/FC->ESC Connection')
  assert.equal(connectionGroupOf(['ESC', 'FC->ESC Connection', 'Type']), 'ESC/FC->ESC Connection')
  // Not a connection pair: a propeller diameter constrains nothing.
  assert.equal(connectionGroupOf(['Propellers', 'Specifications', 'Diameter_inches']), undefined)
  assert.equal(connectionGroupOf(['Flight Controller', 'Notes']), undefined)
})

// ── What a connection TYPE can actually carry ────────────────────────────
//
// Unlike the template pairings above this is a RULE, not evidence: the tables
// come from ArduPilot's own parameter values. So it may genuinely constrain,
// and the tests below are about where it must refuse to.


test('a CAN GNSS speaks DroneCAN and a serial one does not', () => {
  const can = protocolsForConnection(tables, 'GNSS Receiver', 'CAN1')
  assert.ok(can?.has('DroneCAN'))
  assert.ok(!can?.has('uBlox'), 'a CAN receiver was offered a serial protocol')

  const serial = protocolsForConnection(tables, 'GNSS Receiver', 'SERIAL3')
  assert.ok(serial?.has('uBlox'))
  assert.ok(!serial?.has('DroneCAN'), 'a serial receiver was offered DroneCAN')
})

test('an analog battery monitor is not offered an I2C protocol', () => {
  const analog = protocolsForConnection(tables, 'Battery Monitor', 'Analog')
  assert.ok(analog?.has('Analog Voltage and Current'))
  assert.ok(!analog?.has('Solo'), 'an analog monitor was offered an I2C protocol')
})

test('an unfamiliar type gets no opinion rather than an empty list', () => {
  // "Nothing is valid" and "I have not heard of this" are very different
  // answers, and only one of them should empty a dropdown. A vehicle newer
  // than these tables must not lose its options.
  assert.equal(protocolsForConnection(tables, 'GNSS Receiver', 'SERIAL9'), undefined)
  assert.equal(protocolsForConnection(tables, 'GNSS Receiver', ''), undefined)
})

test('a component whose protocol no parameter enumerates is left alone', () => {
  // A telemetry radio's protocol comes from SERIAL*_PROTOCOL, which lists
  // every serial protocol rather than a per-type rule. Constraining it would
  // be inventing a rule ArduPilot does not have.
  assert.equal(protocolsForConnection(tables, 'Telemetry', 'SERIAL1'), undefined)
  assert.equal(protocolsForConnection(tables, 'Propellers', 'SERIAL1'), undefined)
})

test('every protocol the templates actually used is allowed by the rule', () => {
  // The strongest check available: 29 real vehicles, and not one of them may
  // be told its own wiring is invalid. A rule that fails this is wrong, not
  // the vehicles.
  const refuted = []
  for (const [group, byType] of Object.entries(pairings)) {
    const component = group.split('/')[0]
    for (const [type, protocols] of Object.entries(byType)) {
      const allowed = protocolsForConnection(tables, component, type)
      if (!allowed) continue
      for (const protocol of protocols) {
        if (!allowed.has(protocol)) refuted.push(`${group} ${type} → ${protocol}`)
      }
    }
  }
  assert.deepEqual(refuted, [], `the rule refutes wiring real vehicles use:\n${refuted.join('\n')}`)
})

// ── ESC telemetry carried by the control connection ──────────────────────

test('a single-wire ESC protocol mirrors its telemetry connection', () => {
  // FETtecOneWire, Torqeedo, CoDevESC and DroneCAN carry telemetry back over
  // the link that drives the motors. Asking the operator to declare it
  // separately is asking a question with one answer, and inviting a different
  // one that the sequence would then compute from.
  for (const protocol of ['FETtecOneWire', 'Torqeedo', 'CoDevESC', 'DroneCAN']) {
    const mirror = escTelemetryMirror(tables, 'ArduCopter', protocol)
    assert.equal(mirror.type, true, `${protocol} should mirror its telemetry type`)
    assert.equal(mirror.protocol, true, `${protocol} should mirror its telemetry protocol`)
  }
})

test('DShot does NOT mirror, because there the question is real', () => {
  // It can answer back on the same wire (BDShot), use a dedicated serial
  // port, or none at all.
  const mirror = escTelemetryMirror(tables, 'ArduCopter', 'DShot600')
  assert.equal(mirror.type, false)
  assert.equal(mirror.protocol, false)
})

test('a plain PWM ESC does not mirror either', () => {
  const mirror = escTelemetryMirror(tables, 'ArduCopter', 'Normal')
  assert.equal(mirror.type, false)
  assert.equal(mirror.protocol, false)
})

test('the MOT_PWM_TYPE number works as well as the protocol name', () => {
  // The form knows the protocol; the vehicle's parameters know the number.
  assert.deepEqual(
    escTelemetryMirror(tables, 'ArduCopter', '100'),
    escTelemetryMirror(tables, 'ArduCopter', 'FETtecOneWire')
  )
})

test('an unknown protocol or firmware mirrors nothing', () => {
  // Greying out a field on a guess would stop an operator describing their
  // own vehicle.
  assert.deepEqual(escTelemetryMirror(tables, 'ArduCopter', 'NoSuchProtocol'), { type: false, protocol: false })
  assert.deepEqual(escTelemetryMirror(tables, 'NoSuchFirmware', 'DroneCAN'), { type: false, protocol: false })
})
