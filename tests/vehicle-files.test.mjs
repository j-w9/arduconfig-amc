// Assembling a vehicle's configuration directory.
//
// AMC ships 29 fully configured vehicles, each a directory of the files its own
// sequence produced. That makes them the oracle for this too: generate the
// directory for the same aircraft and compare.
//
// What should match, and what should not, is the same split as everywhere else
// in this port. forced_parameters are non-negotiable and must agree.
// derived_parameters are starting points an operator tunes away from -- their
// committed files hold the tuned values, ours hold the computed ones, and
// requiring those to match would be requiring the operator never to have flown.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  directivesOf,
  orderSteps,
  parameterDocsFrom,
  parameterValues,
  parseParamFile,
  defaultsFile,
  parseStepFile,
  vehicleContext,
  vehicleFiles
} from '../packages/amc-steps/dist/index.js'

const root = new URL('..', import.meta.url)
const base = fileURLToPath(
  new URL('vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/ArduCopter/', root)
)
const docs = parameterDocsFrom(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('apps/arduconfigurator/apps/web/src/generated/param-upstream/arducopter.json', root)), 'utf8')
  )
)
const sequence = orderSteps(
  parseStepFile(readFileSync(fileURLToPath(new URL('steps/configuration_steps_ArduCopter.json', root)), 'utf8'))
)

/** Which directive group owns a parameter in a given step. */
const groupOf = new Map()
for (const { filename, step } of sequence) {
  for (const directive of directivesOf(step)) groupOf.set(`${filename}|${directive.parameter}`, directive.group)
}

function templates() {
  return readdirSync(base)
    .filter((name) => statSync(base + name).isDirectory())
    .map((name) => base + name)
    .filter((dir) => existsSync(`${dir}/00_default.param`) && existsSync(`${dir}/vehicle_components.json`))
}

function generate(dir) {
  const defaults = parseParamFile(readFileSync(`${dir}/00_default.param`, 'utf8'))
  const parameters = parameterValues(defaults)
  const context = vehicleContext(readFileSync(`${dir}/vehicle_components.json`, 'utf8'), parameters)
  return vehicleFiles(sequence, context, {
    docs,
    parameters,
    defaults: new Map([...defaults].map(([name, entry]) => [name, entry.value]))
  })
}

test('a good share of the directory comes out byte for byte', () => {
  // Not all of it, and that is expected -- see the derived-parameter note above.
  // This is here so a regression in the writer or the assembly shows up as a
  // number falling rather than as a vague sense that something moved.
  let exact = 0
  let compared = 0
  for (const dir of templates()) {
    for (const file of generate(dir)) {
      const path = `${dir}/${file.filename}`
      if (!existsSync(path)) continue
      compared += 1
      if (file.text === readFileSync(path, 'utf8')) exact += 1
    }
  }
  assert.ok(compared > 1000, `only ${compared} files compared`)
  assert.ok(exact >= 140, `only ${exact} of ${compared} files matched exactly`)
})

test('every forced parameter we write agrees with the vehicle AMC shipped', () => {
  // The invariant that matters. A forced parameter is not negotiable, so ours
  // disagreeing with theirs would mean we are computing it wrongly.
  const mismatches = []
  for (const dir of templates()) {
    for (const file of generate(dir)) {
      const path = `${dir}/${file.filename}`
      if (!existsSync(path)) continue
      const theirs = parseParamFile(readFileSync(path, 'utf8'))
      for (const [name, line] of parseParamFile(file.text)) {
        if (groupOf.get(`${file.filename}|${name}`) !== 'forced_parameters') continue
        const other = theirs.get(name)
        if (!other) continue
        // A value the operator chose over the sequence's is theirs to keep.
        if (other.manualOverride) continue
        if (Math.abs(other.value - line.value) > 1e-6 * Math.max(1, Math.abs(other.value))) {
          mismatches.push(`${dir.slice(base.length)}/${file.filename} ${name}: ${line.value} vs ${other.value}`)
        }
      }
    }
  }
  assert.deepEqual(mismatches.slice(0, 6), [], `${mismatches.length} forced parameters disagreed`)
})

test('a step that sets nothing still gets a file', () => {
  // An empty file says the step was considered and had nothing to set, which
  // is a different statement from the file being absent.
  const files = generate(templates()[0])
  assert.equal(files.length, sequence.length)
  assert.ok(files.some((file) => file.count === 0))
})

test('most of what is written carries the reason it was set', () => {
  // A value without a reason is the thing this method exists to avoid. Not all
  // of them have one -- the sequence leaves some reasons blank -- so the test
  // is a proportion rather than a number pulled out of the air.
  const files = generate(templates()[0])
  const lines = files.flatMap((file) => [...parseParamFile(file.text).values()])
  const withReasons = lines.filter((line) => line.comment)
  assert.ok(lines.length > 50, `only ${lines.length} parameters written`)
  assert.ok(
    withReasons.length / lines.length > 0.6,
    `only ${withReasons.length} of ${lines.length} parameters carried a reason`
  )
})

test('the defaults file is the whole parameter list', () => {
  const dir = templates()[0]
  const defaults = parseParamFile(readFileSync(`${dir}/00_default.param`, 'utf8'))

  const written = defaultsFile(new Map([...defaults].map(([name, entry]) => [name, entry.value])))
  assert.equal(written.filename, '00_default.param')
  assert.equal(parseParamFile(written.text).size, defaults.size)
})
