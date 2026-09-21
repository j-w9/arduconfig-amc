// Battery fields an older declaration does not have.
//
// Volt per cell arm and Volt per cell min were added to AMC's schema in
// v2.11.0. A vehicle_components.json written before that has neither, and the
// sequence reads both — so opening such a directory leaves two battery
// expressions with nothing to evaluate and the failsafe steps quietly produce
// nothing. AMC fills them in rather than asking, because there is a better
// answer than a blank field.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { legacyBatteryFields } from '../packages/amc-steps/dist/index.js'

const tables = JSON.parse(
  readFileSync(fileURLToPath(new URL('../steps/connection-tables.json', import.meta.url)), 'utf8')
)

const key = (field) => `Battery/Specifications/${field}`

/** A declaration from before the two fields existed. */
const legacy = {
  [key('Chemistry')]: 'Lipo',
  [key('Volt per cell max')]: '4.2',
  [key('Volt per cell low')]: '3.6',
  [key('Volt per cell crit')]: '3.3',
  [key('Number of cells')]: '4'
}

test('the vehicle answers when it can, divided by the cell count', () => {
  const fills = legacyBatteryFields(legacy, tables, {
    parameters: { BATT_ARM_VOLT: 15.2, MOT_BAT_VOLT_MIN: 12.8 }
  })
  assert.deepEqual(fills, [
    { key: key('Volt per cell arm'), field: 'Volt per cell arm', value: 3.8, source: 'vehicle' },
    { key: key('Volt per cell min'), field: 'Volt per cell min', value: 3.2, source: 'vehicle' }
  ])
})

test('the chemistry answers when the vehicle cannot', () => {
  const fills = legacyBatteryFields(legacy, tables)
  assert.deepEqual(fills.map((fill) => fill.source), ['chemistry', 'chemistry'])
  // LiPo's own recommendations, not a guess.
  const arm = fills.find((fill) => fill.field === 'Volt per cell arm')
  assert.equal(arm.value, tables._recommended_battery_cell_voltages.Lipo['Volt per cell arm'])
})

test('a pack voltage with no cell count falls back rather than dividing by zero', () => {
  const fills = legacyBatteryFields(
    { ...legacy, [key('Number of cells')]: '' },
    tables,
    { parameters: { BATT_ARM_VOLT: 15.2 } }
  )
  assert.equal(fills.find((fill) => fill.field === 'Volt per cell arm').source, 'chemistry')
})

test('a field already answered is left alone', () => {
  const fills = legacyBatteryFields({ ...legacy, [key('Volt per cell arm')]: '3.75' }, tables, {
    parameters: { BATT_ARM_VOLT: 15.2, MOT_BAT_VOLT_MIN: 12.8 }
  })
  assert.deepEqual(fills.map((fill) => fill.field), ['Volt per cell min'])
})

test('a battery nobody has described is a form to fill in, not a file to migrate', () => {
  // AMC only does this for a document that already has Volt per cell max.
  assert.deepEqual(legacyBatteryFields({}, tables), [])
  assert.deepEqual(legacyBatteryFields({ [key('Chemistry')]: 'Lipo' }, tables), [])
})

test('a modern declaration needs nothing', () => {
  const modern = {
    ...legacy,
    [key('Volt per cell arm')]: '3.8',
    [key('Volt per cell min')]: '3.2'
  }
  assert.deepEqual(legacyBatteryFields(modern, tables), [])
})

test('the derived voltage is rounded the way AMC rounds it', () => {
  // round(x, 4): the quotient of two floats is not a voltage anyone writes.
  const fills = legacyBatteryFields(legacy, tables, { parameters: { BATT_ARM_VOLT: 14.7 } })
  assert.equal(fills.find((fill) => fill.field === 'Volt per cell arm').value, 3.675)
})

test('an unknown chemistry falls back to AMC\'s default rather than failing', () => {
  const fills = legacyBatteryFields({ ...legacy, [key('Chemistry')]: '' }, tables)
  assert.equal(fills.length, 2)
})
