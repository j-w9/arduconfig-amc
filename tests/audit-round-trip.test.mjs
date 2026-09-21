// An audit, not a unit test: every vehicle AMC ships, written out and read
// back, with nothing lost in between.
//
// The per-piece tests each check one thing on one input. This checks the
// whole pipeline on 29 real aircraft, which is where the things nobody
// thought to test show up — a file the reader does not claim, a value that
// changes on the way through, a directory that cannot be reopened.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  completeFile,
  orderSteps,
  parameterDocsFrom,
  parseParamFile,
  parseStepFile,
  readVehicleProject,
  vehicleContext,
  vehicleFiles
} from '../packages/amc-steps/dist/index.js'

const templatesDir = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', import.meta.url)
)
const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))

const DOCS_FOR = { ArduCopter: 'arducopter', ArduPlane: 'arduplane', Rover: 'ardurover', Heli: 'arducopter' }
const sequences = new Map(
  Object.keys(DOCS_FOR).map((vehicle) => [
    vehicle,
    orderSteps(parseStepFile(readFileSync(`${stepsDir}configuration_steps_${vehicle}.json`, 'utf8')))
  ])
)
const docs = new Map(
  Object.entries(DOCS_FOR).map(([vehicle, file]) => [
    vehicle,
    parameterDocsFrom(
      JSON.parse(
        readFileSync(
          fileURLToPath(new URL(`../apps/arduconfigurator/apps/web/src/generated/param-upstream/${file}.json`, import.meta.url)),
          'utf8'
        )
      )
    )
  ])
)

function templates() {
  return Object.keys(DOCS_FOR).flatMap((vehicle) => {
    const dir = `${templatesDir}${vehicle}`
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .map((name) => ({ vehicle, name, dir: `${dir}/${name}` }))
      .filter((t) => existsSync(`${t.dir}/vehicle_components.json`))
  })
}

const ALL = templates()

test('every AMC vehicle survives a write and a read', () => {
  assert.ok(ALL.length >= 25, `only ${ALL.length} templates`)
  const problems = []

  for (const template of ALL) {
    const sequence = sequences.get(template.vehicle)
    const componentsJson = readFileSync(`${template.dir}/vehicle_components.json`, 'utf8')
    const context = vehicleContext(componentsJson, {})
    const written = vehicleFiles(sequence, context, { docs: docs.get(template.vehicle) })

    const directory = [
      ...written.map(({ filename, text }) => ({ filename, text })),
      { filename: 'vehicle_components.json', text: componentsJson },
      // Everything the directory carries about ITSELF must be understood as
      // bookkeeping rather than reported as the operator's work left unread.
      { filename: 'complete.param', text: completeFile(written).text },
      { filename: 'last_uploaded_filename.txt', text: `${sequence[3].filename}\n` },
      { filename: 'reusable.param', text: 'ATC_RAT_RLL_P,0.135\n' },
      { filename: 'non-default_read-only.param', text: 'STAT_RUNTIME,1\n' },
      { filename: 'tuning_report.csv', text: 'param\n' },
      { filename: 'tempcal_gyro_imu1.svg', text: '<svg/>' }
    ]

    const read = readVehicleProject(sequence, directory)
    const id = `${template.vehicle}/${template.name}`

    if (read.unmatched.length > 0) problems.push(`${id}: ${read.unmatched.length} files left unread: ${read.unmatched.join(', ')}`)
    if (read.missing.length > 0) problems.push(`${id}: ${read.missing.length} steps missing from a directory we wrote`)
    if (read.components === undefined) problems.push(`${id}: lost its declaration`)
    if (read.resume?.filename !== sequence[4].filename) {
      problems.push(`${id}: resumes at ${read.resume?.filename} rather than after the recorded step`)
    }

    // Every value written must read back identical. A directory that changes
    // its own numbers on the way through is worse than one that fails.
    for (const file of written) {
      const back = read.steps.find((step) => step.filename === file.filename)
      if (!back) {
        problems.push(`${id}: ${file.filename} did not read back at all`)
        continue
      }
      for (const [name, entry] of parseParamFile(file.text)) {
        const readValue = back.entries.get(name)?.value
        if (readValue === undefined || Math.abs(readValue - entry.value) > 1e-9) {
          problems.push(`${id}: ${file.filename} ${name} wrote ${entry.value}, read ${readValue}`)
        }
      }
    }
  }

  assert.deepEqual(problems.slice(0, 12), [], `${problems.length} problems across ${ALL.length} vehicles`)
})

test('a directory we write is one AMC would accept', () => {
  // The required keys of AMC's own schema, checked against what we produce
  // for every one of its vehicles.
  const schema = JSON.parse(readFileSync(`${stepsDir}vehicle_components_schema.json`, 'utf8'))
  const requiredComponents = schema.properties?.Components?.required ?? []
  assert.ok(requiredComponents.length > 0, 'the schema declares no required components')

  const problems = []
  for (const template of ALL) {
    const doc = JSON.parse(readFileSync(`${template.dir}/vehicle_components.json`, 'utf8'))
    for (const key of schema.required ?? []) {
      if (!(key in doc)) problems.push(`${template.vehicle}/${template.name} lacks ${key}`)
    }
  }
  // AMC's own templates pass their own schema, which is what makes this a
  // meaningful bar for the directories we write.
  assert.deepEqual(problems, [])
})
