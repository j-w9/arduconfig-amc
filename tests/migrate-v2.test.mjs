// Opening a project an older AMC wrote, checked against AMC 5.0.0 doing it.
//
// The corpus is every vehicle template AMC 4.5.7 shipped -- format version 1,
// what anyone who used 4.5.7 has on disk -- plus constructed variants for what
// no template exercises. The expected directories are AMC's own: its
// migration and then its rename step, run under CPython
// (scripts/gen_migration_v2_fixture.py). Every file must match byte for byte,
// vehicle_components.json included.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { migrateProject, openProjectLikeAmc, paramNameFromLine } from '../packages/amc-steps/dist/index.js'

const here = (name) => fileURLToPath(new URL(name, import.meta.url))
const json = (name) => JSON.parse(readFileSync(here(name), 'utf8'))

const fixture = JSON.parse(gunzipSync(readFileSync(here('./fixtures/migration-v2.json.gz'))).toString('utf8'))
const tables = json('../steps/migration.json')
const baselines = json('../steps/baselines.json')
const sidecars = json('../steps/template-sidecars.json')
const VEHICLES = ['ArduCopter', 'ArduPlane', 'Heli', 'Rover']
const steps = Object.fromEntries(VEHICLES.map((v) => [v, json(`../steps/configuration_steps_${v}.json`).steps]))
const templates = {}
for (const vehicle of Object.keys(baselines)) {
  templates[vehicle] = {}
  for (const [version, files] of Object.entries(baselines[vehicle])) {
    templates[vehicle][version] = { ...files, ...(sidecars[vehicle]?.[version] ?? {}) }
  }
}
const context = { tables, steps, templates }

const asFiles = (record) => Object.entries(record).map(([filename, text]) => ({ filename, text }))
const expectedOf = (c) => {
  const out = { ...c.input, ...c.changed }
  for (const name of c.removed) delete out[name]
  return out
}

test('the corpus is the one the generator describes', () => {
  assert.equal(fixture.amc, 'v5.0.0')
  assert.equal(fixture.from, 'v4.5.7')
  const templateCases = fixture.cases.filter((c) => c.name.startsWith('template/'))
  assert.ok(templateCases.length >= 29, `only ${templateCases.length} templates`)
  for (const vehicle of VEHICLES) {
    assert.ok(templateCases.some((c) => c.name.startsWith(`template/${vehicle}/`)), vehicle)
  }
})

test('every project opens exactly as AMC 5.0.0 leaves it', () => {
  const problems = []
  for (const c of fixture.cases) {
    const opened = openProjectLikeAmc(asFiles(c.input), context)
    const ours = Object.fromEntries(opened.files.map((file) => [file.filename, file.text]))
    const theirs = expectedOf(c)
    const names = new Set([...Object.keys(ours), ...Object.keys(theirs)])
    for (const name of [...names].sort()) {
      if (ours[name] === theirs[name]) continue
      if (!(name in ours)) problems.push(`${c.name}: we lack ${name}`)
      else if (!(name in theirs)) problems.push(`${c.name}: we have ${name}, AMC does not`)
      else problems.push(`${c.name}: ${name} differs`)
    }
  }
  assert.deepEqual(problems.slice(0, 15), [], `${problems.length} differences`)
})

test('a current project is left alone by the migration', () => {
  const current = fixture.cases.find((c) => c.name === 'variant/already-v2')
  assert.equal(migrateProject(asFiles(current.input), context), undefined)
})

test('the account names what moved, what was surfaced and what was dropped', () => {
  const unmapped = fixture.cases.find((c) => c.name === 'variant/copter-unmapped')
  const { migration } = openProjectLikeAmc(asFiles(unmapped.input), context)
  assert.ok(migration)
  assert.equal(migration.from, 1)
  assert.equal(migration.to, 2)
  // The operator's accelerometer calibration went to the step that owns it now.
  assert.ok(
    migration.moved.some((m) => /^INS_ACCSCAL_[XYZ]$/.test(m.parameter) && m.to === '16_accelerometer_calibration.param')
  )
  // Nothing claims this one, so it is put in front of the operator.
  assert.deepEqual(
    migration.surfaced.filter((s) => s.parameter === 'ZZ_UNKNOWN_PARAM').map((s) => s.to),
    ['23_general_configuration.param']
  )
  // MOT_SPIN_ARM is forced by the motor step in the new layout and is taken
  // out of the old file rather than carried.
  assert.ok(migration.dropped.some((d) => d.parameter === 'MOT_SPIN_ARM'))
})

test('a value the operator already put in the new step outlives an earlier file', () => {
  // 14_ sorts before 24_, so the old combined step is the EARLIER statement
  // and a non-forced move does not overwrite the destination's own value.
  const c = fixture.cases.find((x) => x.name === 'variant/copter-destination-exists')
  const opened = openProjectLikeAmc(asFiles(c.input), context)
  const safety = opened.files.find((f) => f.filename === '24_safety_setup.param').text
  const line = safety.split('\n').find((l) => paramNameFromLine(l) === 'FENCE_ALT_MAX')
  assert.equal(line, 'FENCE_ALT_MAX,77')
  assert.equal(expectedOf(c)['24_safety_setup.param'], safety)
})

test('the parameter name is read as AMC reads it', () => {
  assert.equal(paramNameFromLine('INS_USE,1  # comment'), 'INS_USE')
  assert.equal(paramNameFromLine('COMPASS_USE\t1'), 'COMPASS_USE')
  assert.equal(paramNameFromLine('AHRS_TRIM_X 0.01'), 'AHRS_TRIM_X')
  // The inline comment is cut before separators are looked for.
  assert.equal(paramNameFromLine('NAME\t4 # a b'), 'NAME')
  assert.equal(paramNameFromLine('   # only a comment'), '')
  assert.equal(paramNameFromLine(''), '')
})
