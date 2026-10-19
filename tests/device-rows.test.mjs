import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { deviceRows } from '../packages/amc-steps/dist/index.js'

/*
 * AMC's device table, ported -- and checked against AMC's own device_rows()
 * run under CPython (scripts/gen_devid_fixtures.py), not against a reading of
 * it. Every driver in every table, a whole vehicle with prioritised compasses,
 * and the edges the Python handles by truncating or skipping.
 */

const tables = JSON.parse(readFileSync(new URL('../steps/devid.json', import.meta.url), 'utf8'))
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/device-rows.json', import.meta.url), 'utf8'))

const asTuple = (row) => [row.name, row.busType, row.bus, row.address, row.devtype, row.priority ?? null, row.source]

test('every parameter set decodes exactly as AMC decodes it', () => {
  const diverged = []
  for (const { params, rows } of fixtures) {
    const ours = deviceRows(params, tables).map(asTuple)
    if (JSON.stringify(ours) !== JSON.stringify(rows)) diverged.push({ params, ours, amc: rows })
  }
  assert.deepEqual(diverged.slice(0, 3), [], `${diverged.length} of ${fixtures.length} parameter sets diverged from CPython`)
})

test('the fixture actually exercises something', () => {
  // A parity test over nothing passes trivially.
  const rows = fixtures.flatMap((f) => f.rows)
  assert.ok(fixtures.length > 50)
  assert.ok(rows.some((r) => r[4] === 'DRONECAN'), 'a DroneCAN device')
  assert.ok(rows.some((r) => r[5] !== null), 'a compass with a priority')
  assert.ok(rows.some((r) => r[4] === 'UNKNOWN'), 'an unknown driver')
})

test('the fixture was made from the devid.json that is synced now', () => {
  // A table refresh without regenerating the fixture would compare the port
  // against an older AMC.
  const names = new Set(fixtures.flatMap((f) => f.rows.map((r) => r[4])))
  for (const category of ['compass', 'imu', 'baro', 'airspeed']) {
    for (const entry of tables.device_types[category]) {
      const stripped = entry.name.replace(/^(?:(?:DEVTYPE_?|INS_|BARO_|ACC_|GYR_))+/i, '')
      assert.ok(names.has(stripped), `${category} ${entry.name} is in devid.json but not in the fixture -- regenerate it`)
    }
  }
})
