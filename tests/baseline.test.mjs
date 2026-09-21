// The values a directory starts from, before the sequence edits any of them.
//
// AMC does not compute a vehicle directory from nothing: it copies a template's
// .param files and lets the directives override what they have an opinion
// about. Which template matters — copying a real aircraft's would assert its
// antenna offsets and wiring as this vehicle's. AMC's own answer, when it
// creates a project from a connected flight controller, is the EMPTY template
// for that firmware, and that is what this carries across.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  baselineFor,
  baselineVersions,
  orderSteps,
  parseParamFile,
  parseStepFile,
  releaseLine,
  vehicleContext,
  vehicleFiles
} from '../packages/amc-steps/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const table = JSON.parse(readFileSync(root + 'steps/baselines.json', 'utf8'))
const sequence = orderSteps(
  parseStepFile(readFileSync(root + 'steps/configuration_steps_ArduCopter.json', 'utf8'))
)
const emptyDir =
  root + 'vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/ArduCopter/empty_4.6.x'

test('a reported firmware version reduces to its release line', () => {
  // The link reports whatever the vehicle says; the templates are named by
  // release line rather than patch.
  assert.equal(releaseLine('4.6.3 (official)'), '4.6')
  assert.equal(releaseLine('4.6'), '4.6')
  assert.equal(releaseLine('ArduCopter V4.7.0-beta2'), '4.7')
  assert.equal(releaseLine(undefined), undefined)
  assert.equal(releaseLine('unknown'), undefined)
})

test('a baseline is found for a firmware AMC ships an empty template for', () => {
  const baseline = baselineFor(table, 'ArduCopter', '4.6.3')
  assert.equal(baseline.version, '4.6')
  assert.ok(baseline.count > 500, `only ${baseline.count} parameters`)
  assert.ok(baseline.files.get('08_telemetry.param').has('SERIAL1_BAUD'))
})

test('there is no falling back to a neighbouring release', () => {
  // AMC raises rather than substituting: a 4.5 baseline on 4.7 firmware would
  // seed parameters that have since been renamed.
  assert.equal(baselineFor(table, 'ArduCopter', '4.4.0'), undefined)
  assert.equal(baselineFor(table, 'ArduCopter', undefined), undefined)
  // A vehicle AMC ships no empty template for gets none, rather than another
  // vehicle's.
  assert.equal(baselineFor(table, 'Rover', '4.6.0'), undefined)
})

test('the versions on offer are ordered by release, not alphabetically', () => {
  const versions = baselineVersions(table, 'ArduCopter')
  assert.deepEqual(versions, ['4.5', '4.6', '4.7'])
  assert.deepEqual(baselineVersions(table, 'ArduSubmarine'), [])
})

test('a seeded directory holds everything AMC\'s own does', () => {
  // The measurement this exists for: without a baseline the directives produce
  // 69 of the 662 parameters in AMC's empty_4.6.x directory.
  const context = vehicleContext(readFileSync(emptyDir + '/vehicle_components.json', 'utf8'), {})
  const baseline = baselineFor(table, 'ArduCopter', '4.6.3')
  const files = vehicleFiles(sequence, context, { baseline })

  let theirs = 0
  let present = 0
  for (const file of files) {
    const path = `${emptyDir}/${file.filename}`
    if (!existsSync(path)) continue
    const mine = new Set(parseParamFile(file.text).keys())
    for (const name of parseParamFile(readFileSync(path, 'utf8')).keys()) {
      theirs += 1
      if (mine.has(name)) present += 1
    }
  }
  assert.ok(theirs > 500, `only ${theirs} parameters to compare against`)
  assert.equal(present, theirs, `${theirs - present} of AMC's parameters are still missing`)
})

test('the sequence overrides the baseline, and is right to', () => {
  // A real case, and the reason the precedence is this way round. AMC's empty
  // templates ship INS_HNTCH_MODE,3 — ESC telemetry RPM — while their own
  // declaration says the ESC sends no telemetry, so the sequence computes 1.
  // The shipped file is stale; the computed value is what AMC's own sequence
  // says. A baseline that won here would carry that staleness forward.
  const context = vehicleContext(readFileSync(emptyDir + '/vehicle_components.json', 'utf8'), {})
  const baseline = baselineFor(table, 'ArduCopter', '4.6.3')
  const file = vehicleFiles(sequence, context, { baseline }).find(
    (entry) => entry.filename === '21_motor_notch_filter_setup.param'
  )
  const line = parseParamFile(file.text).get('INS_HNTCH_MODE')
  assert.equal(line.value, 1)
  assert.match(line.comment, /throttle-based/)
})

test('a baseline value carries no reason, because it is not a decision', () => {
  // These are the firmware-shaped values the empty template holds. Attaching
  // a justification to one would claim the sequence chose it.
  const context = vehicleContext(JSON.stringify({ Components: {} }), {})
  const baseline = baselineFor(table, 'ArduCopter', '4.6.3')
  const file = vehicleFiles(sequence, context, { baseline }).find(
    (entry) => entry.filename === '08_telemetry.param'
  )
  assert.equal(parseParamFile(file.text).get('SERIAL1_BAUD').comment, undefined)
})

test('without a baseline nothing changes', () => {
  const context = vehicleContext(JSON.stringify({ Components: {} }), {})
  const before = vehicleFiles(sequence, context, {})
  const after = vehicleFiles(sequence, context, { baseline: undefined })
  assert.deepEqual(after.map((file) => file.text), before.map((file) => file.text))
})
