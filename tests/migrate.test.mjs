// Bringing a directory an older AMC wrote up to the current layout.
//
// old_filenames covers the renames and reading a project already honours them.
// What it cannot express is the rest of format version 0 -> 1: parameters that
// MOVED between step files, files that did not exist before, and files the
// sequence has since dropped.
//
// Without it a pre-v1 directory reads almost correctly, which is the worst way
// to be wrong: BRD_HEAT_TARG stays in the board-orientation file so the step
// that owns it now shows nothing recorded, and 09_batt2.param -- retired
// upstream -- is reported to the operator as a file left unread.
//
// The expected output is AMC's own, byte for byte
// (scripts/gen_migration_fixture.py).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  formatVersionOf,
  migrateProject,
  vehicleTypeOf,
  withFormatVersion
} from '../packages/amc-steps/dist/index.js'

const read = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8'))

const tables = read('../steps/migration.json')
const input = read('./fixtures/v0-directory.json')
const expected = read('./fixtures/v0-migrated.json')

const asFiles = (record) => Object.entries(record).map(([filename, text]) => ({ filename, text }))

test('a v0 directory comes out exactly as AMC would leave it', () => {
  const result = migrateProject(asFiles(input), tables)
  assert.ok(result, 'a v0 directory needs migrating')

  const ours = Object.fromEntries(result.files.map((file) => [file.filename, file.text]))
  for (const [filename, text] of Object.entries(expected.files)) {
    // The declaration itself differs: AMC rewrites it in place with its own
    // indentation, which is a filesystem concern rather than a migration one.
    if (filename === 'vehicle_components.json') continue
    assert.equal(ours[filename], text, filename)
  }

  const theirs = Object.keys(expected.files).filter((name) => name !== 'vehicle_components.json')
  assert.deepEqual(
    Object.keys(ours).filter((name) => name !== 'vehicle_components.json').sort(),
    theirs.sort()
  )
})

test('the parameters that moved are named, not just relocated', () => {
  // The operator opened a directory and it changed shape; they are owed an
  // account of what happened to their values.
  const { moved } = migrateProject(asFiles(input), tables)
  const heat = moved.find((entry) => entry.parameter === 'BRD_HEAT_TARG')
  assert.deepEqual(heat, {
    parameter: 'BRD_HEAT_TARG',
    from: '04_board_orientation.param',
    to: '04_imu_temperature_calibration_finish.param'
  })
  // The RC controller split is the other half of the same story.
  assert.ok(moved.some((entry) => entry.parameter === 'FS_THR_VALUE'))
})

test('a retired file is reported with what it still held', () => {
  // 09_batt2.param is deleted by the migration. Saying so beats the current
  // behaviour, which reports it as a file that could not be read.
  const { removed } = migrateProject(asFiles(input), tables)
  const batt2 = removed.find((entry) => entry.filename === '09_batt2.param')
  assert.ok(batt2)
  // Empty by the time it is deleted: BATT2_MONITOR moved out first, which is
  // the order AMC runs these in and the reason nothing is lost.
  assert.deepEqual(batt2.parameters, [])
})

test('an @manual_override survives the move', () => {
  // The whole reason to move it rather than drop it: a decision the operator
  // recorded is the one thing a rewrite must not quietly revert.
  const { files } = migrateProject(asFiles(input), tables)
  const destination = files.find(
    (file) => file.filename === '04_imu_temperature_calibration_finish.param'
  )
  assert.match(destination.text, /BRD_HEAT_TARG,45\s+# @manual_override warm board/)
})

test('running it twice changes nothing the second time', () => {
  // Parameters are removed from the source as they are taken, which is what
  // makes this idempotent rather than duplicating on every open.
  const once = migrateProject(asFiles(input), tables)
  const declared = withFormatVersion(input['vehicle_components.json'], tables.VEHICLE_COMPONENTS_FORMAT_VERSION)
  const twice = migrateProject(
    once.files.map((file) =>
      file.filename === 'vehicle_components.json' ? { ...file, text: declared } : file
    ),
    tables,
    { componentsJson: declared }
  )
  assert.equal(twice, undefined, 'a migrated directory does not need migrating again')
})

test('a current directory is left alone', () => {
  const current = { 'Format version': 1, Components: {} }
  assert.equal(
    migrateProject([{ filename: 'vehicle_components.json', text: JSON.stringify(current) }], tables),
    undefined
  )
})

test('a declaration with no format version predates the field', () => {
  // The field was introduced by the version that needed it, so its absence is
  // not "unknown" -- it is 0.
  assert.equal(formatVersionOf(undefined), 0)
  assert.equal(formatVersionOf('{}'), 0)
  assert.equal(formatVersionOf('{not json'), 0)
  assert.equal(formatVersionOf('{"Format version": 1}'), 1)
})

test('the vehicle type selects the type-specific moves', () => {
  assert.equal(vehicleTypeOf(input['vehicle_components.json']), 'ArduCopter')
  assert.equal(vehicleTypeOf('{}'), '')
  // A type the tables have never heard of still gets the "all" moves rather
  // than refusing the whole migration, which is what AMC does.
  const unknown = migrateProject(asFiles(input), tables, { vehicleType: 'ArduSubmarine' })
  assert.ok(unknown.moved.length > 0)
})

test('the fixture is a real v0 directory, not an empty one', () => {
  // Otherwise every assertion above passes over nothing.
  assert.ok(Object.keys(input).length >= 4)
  assert.ok(Object.keys(expected.files).length >= 10)
  assert.equal(expected.migrated, true)
})
