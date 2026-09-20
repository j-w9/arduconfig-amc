// Explaining a blocked step in the operator's terms.
//
// The four failure classes the vendored templates actually produce, checked
// against real steps rather than invented ones: an undeclared component, a
// declared-but-unusable value, a parameter the firmware does not have, and a
// named value with no number behind it.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  applyStep,
  describePath,
  diagnose,
  orderSteps,
  parameterDocsFrom,
  parseStepFile,
  vehicleContext
} from '../packages/amc-steps/dist/index.js'

const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))
const templatesDir = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', import.meta.url)
)
const copter = orderSteps(parseStepFile(readFileSync(`${stepsDir}configuration_steps_ArduCopter.json`, 'utf8')))
const docs = parameterDocsFrom(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../apps/arduconfigurator/apps/web/src/generated/param-upstream/arducopter.json', import.meta.url)),
      'utf8'
    )
  )
)

function readParamFile(path) {
  const params = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim()
    if (!line) continue
    const match = /^(\S+)[,\s]+(\S+)$/.exec(line)
    if (!match) continue
    const value = Number(match[2])
    if (!Number.isNaN(value)) params[match[1]] = value
  }
  return params
}

/** Every failure the sequence produces for a given declared vehicle. */
function failuresFor(componentsJson, parameters = {}) {
  const context = vehicleContext(componentsJson, parameters)
  const components = JSON.parse(componentsJson).Components
  const found = []
  for (const { filename, step } of copter) {
    for (const failure of applyStep(step, context, { docs }).failures) {
      found.push({ filename, failure, diagnosis: diagnose(failure, components) })
    }
  }
  return found
}

test('an undeclared vehicle is explained as fields to declare', () => {
  const found = failuresFor('{"Components": {}}')
  assert.ok(found.length > 0, 'an empty vehicle should block steps')

  const undeclared = found.filter((entry) => entry.diagnosis.kind === 'undeclared-component')
  assert.ok(undeclared.length > 0, 'nothing was reported as undeclared')

  for (const entry of undeclared) {
    assert.ok(entry.diagnosis.declare.length > 0, 'undeclared-component names no field')
    // The point of the exercise: no evaluator jargon in the summary.
    assert.doesNotMatch(entry.diagnosis.summary, /KeyError|PyError|undefined/)
    assert.match(entry.diagnosis.summary, /^Declare /)
  }

  const esc = undeclared.find((entry) => entry.failure.parameter === 'MOT_PWM_TYPE')
  assert.ok(esc, 'the ESC protocol step should be blocked')
  assert.equal(
    esc.diagnosis.summary,
    "Declare ESC › FC->ESC Connection › Protocol to set MOT_PWM_TYPE."
  )
})

test('a declared but unusable value is not reported as undeclared', () => {
  // The blank templates declare their components and leave the numbers at zero,
  // which is a different problem from never having answered.
  const blank = `${templatesDir}ArduCopter/empty_4.6.x`
  assert.ok(existsSync(blank), 'the blank template is missing')
  const found = failuresFor(
    readFileSync(`${blank}/vehicle_components.json`, 'utf8'),
    readParamFile(`${blank}/00_default.param`)
  )

  const unusable = found.filter((entry) => entry.diagnosis.kind === 'unusable-component')
  assert.ok(unusable.length > 0, 'a zero propeller diameter should be reported as unusable')
  for (const entry of unusable) {
    assert.ok(entry.diagnosis.depends.length > 0)
    assert.match(entry.diagnosis.summary, /check the value/)
  }
  assert.ok(
    unusable.some((entry) =>
      entry.diagnosis.depends.some((path) => path.includes('Diameter_inches'))
    ),
    'the propeller diameter should be named'
  )
})

test('a parameter the firmware lacks is named as such', () => {
  const plane = orderSteps(parseStepFile(readFileSync(`${stepsDir}configuration_steps_ArduPlane.json`, 'utf8')))
  const template = `${templatesDir}ArduPlane/normal_plane`
  const componentsJson = readFileSync(`${template}/vehicle_components.json`, 'utf8')
  const context = vehicleContext(componentsJson, readParamFile(`${template}/00_default.param`))
  const components = JSON.parse(componentsJson).Components

  const absent = []
  for (const { step } of plane) {
    for (const failure of applyStep(step, context).failures) {
      const diagnosis = diagnose(failure, components)
      if (diagnosis.kind === 'absent-parameter') absent.push(diagnosis)
    }
  }

  assert.ok(absent.length > 0, 'the Copter-only parameter reads should be reported')
  assert.ok(
    absent.some((diagnosis) => diagnosis.parameters.includes('MOT_THST_HOVER')),
    'MOT_THST_HOVER should be named as unreported'
  )
  assert.match(absent[0].summary, /which this vehicle does not report/)
})

test('a fully declared vehicle produces nothing to explain', () => {
  // Found by scanning rather than named, so a template being renamed or
  // dropped upstream does not turn into a false failure here.
  const candidates = readdirSync(`${templatesDir}ArduCopter`)
    .map((name) => `${templatesDir}ArduCopter/${name}`)
    .filter(
      (dir) => existsSync(`${dir}/vehicle_components.json`) && existsSync(`${dir}/00_default.param`)
    )
  assert.ok(candidates.length > 0, 'no usable Copter templates')

  const clean = candidates.filter(
    (dir) =>
      failuresFor(readFileSync(`${dir}/vehicle_components.json`, 'utf8'), readParamFile(`${dir}/00_default.param`))
        .length === 0
  )
  assert.ok(
    clean.length > 0,
    `every Copter template had something to explain, across ${candidates.length} templates`
  )
})

test('describePath reads as a form field, not a code path', () => {
  assert.equal(describePath(['Battery', 'Specifications', 'Number of cells']), 'Battery › Specifications › Number of cells')
})
