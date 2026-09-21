// How long to wait for a flight controller to come back.
//
// A step that sets a boot-time parameter is finished when the vehicle has
// restarted and read it, not when the write is acknowledged.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { changesBootDelay, rebootWaitSeconds } from '../packages/amc-steps/dist/index.js'

test('a board with no configured delay still gets a moment', () => {
  assert.equal(rebootWaitSeconds(), 1)
  assert.equal(rebootWaitSeconds({ current: 0 }), 1)
})

test('the configured delay is added, rounded up', () => {
  // Coming back late costs a moment; coming back early costs a failed
  // connection and an operator wondering whether the write took.
  assert.equal(rebootWaitSeconds({ current: 3000 }), 4)
  assert.equal(rebootWaitSeconds({ current: 2500 }), 3)
})

test('the LARGER of the current and staged delay wins', () => {
  // The step may be the very thing that changes BRD_BOOT_DELAY. Using only
  // the current value reconnects too early on the reboot that lengthens it;
  // using only the staged value does the same on every other reboot.
  assert.equal(rebootWaitSeconds({ current: 1000, staged: 5000 }), 6)
  assert.equal(rebootWaitSeconds({ current: 5000, staged: 1000 }), 6)
})

test('nonsense values are ignored rather than trusted', () => {
  // A negative or NaN delay must not produce a negative wait, which would
  // reconnect instantly and look like the reboot never happened.
  for (const bad of [-1000, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    const wait = rebootWaitSeconds({ current: bad })
    assert.ok(Number.isFinite(wait) && wait >= 1, `${bad} produced ${wait}`)
  }
})

test('a step that sets the boot delay is recognised', () => {
  assert.equal(changesBootDelay([{ parameter: 'BRD_BOOT_DELAY', value: 3000 }]), 3000)
  assert.equal(changesBootDelay([{ parameter: 'LOG_BITMASK', value: 1 }]), undefined)
  assert.equal(changesBootDelay([]), undefined)
})
