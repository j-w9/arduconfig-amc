// Reading a vehicle directory back in, against AMC's own directories.
//
// The templates are real projects AMC wrote, so they are the oracle for the
// reading side exactly as they are for the runner: if a directory AMC produced
// does not read cleanly here, the format is being guessed at rather than
// followed.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  orderSteps,
  parseStepFile,
  readVehicleProject,
  vehicleContext,
  vehicleFiles
} from '../packages/amc-steps/dist/index.js'

const templatesDir = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', import.meta.url)
)
const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))

const sequence = orderSteps(
  parseStepFile(readFileSync(`${stepsDir}configuration_steps_ArduCopter.json`, 'utf8'))
)

function templateFiles(vehicle, name) {
  const dir = `${templatesDir}${vehicle}/${name}`
  return readdirSync(dir)
    .filter((f) => f.endsWith('.param') || f === 'vehicle_components.json')
    .map((filename) => ({ filename, text: readFileSync(`${dir}/${filename}`, 'utf8') }))
}

function copterTemplates() {
  return readdirSync(`${templatesDir}ArduCopter`).filter((name) =>
    existsSync(`${templatesDir}ArduCopter/${name}/vehicle_components.json`)
  )
}

test('every ArduCopter template reads with nothing left over', () => {
  const templates = copterTemplates()
  assert.ok(templates.length >= 10, `only ${templates.length} templates found`)

  for (const name of templates) {
    const project = readVehicleProject(sequence, templateFiles('ArduCopter', name))
    // A file the sequence cannot place is the failure mode that matters: it
    // means an operator's work is sitting in the directory unread.
    assert.deepEqual(project.unmatched, [], `${name} left files unread`)
    assert.ok(project.components !== undefined, `${name} lost its components`)
    assert.ok(project.steps.length > 0, `${name} matched no steps at all`)
  }
})

test('the defaults file comes back as the firmware values, not as a step', () => {
  const name = copterTemplates().find((t) =>
    existsSync(`${templatesDir}ArduCopter/${t}/00_default.param`)
  )
  const project = readVehicleProject(sequence, templateFiles('ArduCopter', name))
  assert.ok(project.defaults !== undefined, '00_default.param was not read')
  assert.ok(project.defaults.size > 500, `only ${project.defaults.size} defaults`)
  assert.ok(
    !project.steps.some((s) => s.filename === '00_default.param'),
    'the defaults file was also claimed as a step'
  )
})

test('a decision recorded as @manual_override is recovered', () => {
  // Holybro_X500 keeps Medium Attitude logging on during PID notch tuning
  // (LOG_BITMASK 407519 rather than the step file's 407517). That is the
  // operator's decision, and losing it on read means the next write silently
  // reverts it.
  const project = readVehicleProject(sequence, templateFiles('ArduCopter', 'Holybro_X500'))
  const override = project.overrides.get('LOG_BITMASK')
  assert.ok(override, `no LOG_BITMASK override; got ${[...project.overrides.keys()].join(', ')}`)
  assert.equal(override.value, 407519)
})

test('a directory written under the old names still reads', () => {
  // This is what old_filenames is for. Renaming every file the sequence has an
  // old name for produces exactly the directory an older AMC wrote.
  const renamable = sequence.filter((s) => (s.step.old_filenames ?? []).length > 0)
  assert.ok(renamable.length > 0, 'the sequence carries no old_filenames to test')

  const files = renamable.map(({ filename, step }) => ({
    filename: step.old_filenames[0],
    text: `# was ${filename}\nSTUB_PARAM,1\n`
  }))
  const project = readVehicleProject(sequence, files)

  assert.deepEqual(project.unmatched, [], 'an old name went unclaimed')
  assert.equal(project.renamed.length, renamable.length)
  for (const { from, to } of project.renamed) {
    const step = sequence.find((s) => s.filename === to)
    assert.ok(step.step.old_filenames.includes(from), `${from} is not an old name of ${to}`)
  }
})

test('the current name wins when a directory holds both', () => {
  // A half-finished migration. The file under the name THIS sequence uses is
  // the one this sequence wrote, and the stale one is reported rather than
  // silently dropped.
  const step = sequence.find((s) => (s.step.old_filenames ?? []).length > 0)
  const old = step.step.old_filenames[0]
  const project = readVehicleProject(sequence, [
    { filename: old, text: 'LOG_BITMASK,1\n' },
    { filename: step.filename, text: 'LOG_BITMASK,2\n' }
  ])

  const read = project.steps.find((s) => s.filename === step.filename)
  assert.equal(read.foundAs, step.filename)
  assert.equal(read.entries.get('LOG_BITMASK').value, 2)
  assert.deepEqual(project.renamed, [])
  assert.deepEqual(project.unmatched, [old])
})

test('a path is read by its basename, however the caller got the file', () => {
  // A directory picker hands over paths, a zip hands over entry names.
  const project = readVehicleProject(sequence, [
    { filename: 'MyCopter/02_imu_temperature_calibration_setup.param', text: 'INS_TCAL1_ENABLE,2\n' }
  ])
  assert.equal(project.steps.length, 1)
  assert.equal(project.steps[0].entries.get('INS_TCAL1_ENABLE').value, 2)
})

test('what we write, we read back unchanged', () => {
  // The round trip is the point of both halves. Values only -- the reasons are
  // comments and the writer rewrites them from the step files.
  const dir = `${templatesDir}ArduCopter/Holybro_X500_V2`
  const context = vehicleContext(
    readFileSync(`${dir}/vehicle_components.json`, 'utf8'),
    new Map()
  )
  const written = vehicleFiles(sequence, context)
  const project = readVehicleProject(
    sequence,
    written.map(({ filename, text }) => ({ filename, text }))
  )

  assert.deepEqual(project.unmatched, [])
  assert.deepEqual(project.missing, [])
  for (const file of written) {
    const read = project.steps.find((s) => s.filename === file.filename)
    assert.ok(read, `${file.filename} did not read back`)
    assert.equal(read.entries.size, file.count, `${file.filename} changed size on the round trip`)
  }
})
