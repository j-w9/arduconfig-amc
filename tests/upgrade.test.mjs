// Parameters ArduPilot renamed between firmware versions.
//
// A directory written against 4.5 and reopened against 4.7 names parameters
// the vehicle no longer has. Without the rename, reading it back silently
// drops the operator's values — the file says one thing, the vehicle has
// another, and nothing reports the gap.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { upgradeParameters, upgradesBetween } from '../packages/amc-steps/dist/index.js'

const tables = JSON.parse(
  readFileSync(fileURLToPath(new URL('../steps/connection-tables.json', import.meta.url)), 'utf8')
)

/** Plain numbers: the simplest shape the upgrade has to work over. */
const upgrade = (params, crossed) =>
  upgradeParameters(
    new Map(Object.entries(params)),
    tables,
    crossed,
    (value) => value,
    (_entry, value) => value
  )

test('only the upgrades the vehicle has crossed and the file has not', () => {
  assert.deepEqual(upgradesBetween('4.5.0', '4.7.0'), [4.6, 4.7])
  assert.deepEqual(upgradesBetween('4.6.0', '4.7.0'), [4.7])
  assert.deepEqual(upgradesBetween('4.6.0', '4.6.3'), [])
  // A file NEWER than the vehicle is not downgraded: the operator would be
  // the one to explain that, and guessing would move values that should stay.
  assert.deepEqual(upgradesBetween('4.7.0', '4.6.0'), [])
})

test('an unknown version on either side renames nothing', () => {
  // Renaming on a guess moves values that should have stayed put.
  assert.deepEqual(upgradesBetween('', '4.7.0'), [])
  assert.deepEqual(upgradesBetween('4.5.0', ''), [])
  assert.deepEqual(upgradesBetween('not a version', '4.7.0'), [])
})

test('a 4.6 rename moves the value under its new name', () => {
  const { parameters, renamed } = upgrade({ GPS_CAN_NODEID1: 17 }, [4.6])
  assert.equal(parameters.get('GPS1_CAN_NODEID'), 17)
  assert.equal(parameters.has('GPS_CAN_NODEID1'), false)
  assert.deepEqual(renamed, [{ from: 'GPS_CAN_NODEID1', to: 'GPS1_CAN_NODEID', value: 17 }])
})

test('a rename that changed UNITS scales the value too', () => {
  // ANGLE_MAX was centidegrees; ATC_ANGLE_MAX is degrees. Carrying 3000
  // across unchanged would set a 3000-degree lean angle and look like it had
  // worked, which is worse than not renaming at all.
  const { parameters, renamed } = upgrade({ ANGLE_MAX: 3000 }, [4.7])
  assert.equal(parameters.get('ATC_ANGLE_MAX'), 30)
  const entry = renamed.find((r) => r.from === 'ANGLE_MAX')
  assert.equal(entry.scale, 0.01)
  assert.equal(entry.value, 30)
})

test('a name-only 4.7 rename reports no scale', () => {
  // The scale is only worth mentioning when it changed something.
  const { renamed } = upgrade({ EK3_MAX_FLOW: 5 }, [4.7])
  assert.deepEqual(renamed, [{ from: 'EK3_MAX_FLOW', to: 'EK3_FLOW_MAX', value: 5 }])
})

test('a directory already holding the new name keeps the current value', () => {
  // It has been upgraded before. Renaming over it would replace the value the
  // operator has with the stale one beside it.
  const { parameters, renamed } = upgrade({ EK3_MAX_FLOW: 5, EK3_FLOW_MAX: 9 }, [4.7])
  assert.equal(parameters.get('EK3_FLOW_MAX'), 9)
  assert.equal(parameters.has('EK3_MAX_FLOW'), false)
  assert.deepEqual(renamed, [])
})

test('parameters with no rename are untouched', () => {
  const { parameters, renamed } = upgrade({ INS_GYR_CAL: 1, LOG_BITMASK: 65535 }, [4.6, 4.7])
  assert.equal(parameters.get('INS_GYR_CAL'), 1)
  assert.equal(parameters.get('LOG_BITMASK'), 65535)
  assert.deepEqual(renamed, [])
})

test('crossing nothing is a no-op that keeps the very same map', () => {
  const before = new Map([['ANGLE_MAX', 3000]])
  const { parameters, renamed } = upgradeParameters(before, tables, [], (v) => v, (_e, v) => v)
  assert.equal(parameters, before)
  assert.deepEqual(renamed, [])
})

test('the upgrade works over a richer entry without flattening it', () => {
  // A parsed .param entry carries its comment and its @manual_override flag,
  // and a rename must not throw those away.
  const entries = new Map([['ANGLE_MAX', { name: 'ANGLE_MAX', value: 3000, comment: 'why', manualOverride: true }]])
  const { parameters } = upgradeParameters(
    entries,
    tables,
    [4.7],
    (entry) => entry.value,
    (entry, value) => ({ ...entry, name: 'ATC_ANGLE_MAX', value })
  )
  const moved = parameters.get('ATC_ANGLE_MAX')
  assert.equal(moved.value, 30)
  assert.equal(moved.comment, 'why')
  assert.equal(moved.manualOverride, true, 'a recorded decision was lost in the rename')
})

test('the tables are the real ones, not an empty stub', () => {
  // An extraction that silently produced nothing would make every test above
  // pass by doing nothing at all.
  assert.ok(Object.keys(tables.PARAM_UPGRADE_DICT_46).length >= 15)
  assert.ok(Object.keys(tables.PARAM_UPGRADE_DICT_47).length >= 50)
  // And the scaled renames are present, which is the half that can go wrong.
  const scaled = Object.values(tables.PARAM_UPGRADE_DICT_47).filter(([, scale]) => scale !== 1)
  assert.ok(scaled.length > 0, 'no unit-changing renames survived extraction')
})
