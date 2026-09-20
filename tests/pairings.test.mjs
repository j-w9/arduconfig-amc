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

import { connectionGroupOf, orderByPairing } from '../packages/amc-steps/dist/index.js'

const pairings = JSON.parse(
  readFileSync(fileURLToPath(new URL('../steps/component-pairings.json', import.meta.url)), 'utf8')
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
