// End-to-end: run the real sequence over the real vehicles.
//
// AMC's templates ship the .param files it produced for each vehicle, which
// makes them an oracle for the whole stack rather than just the evaluator. The
// invariant is asymmetric, and the asymmetry is the point:
//
//   forced_parameters  -- non-negotiable, so the runner must reproduce them
//   derived_parameters -- starting points an operator tunes away from
//                         (PSC_ACCZ_*, INS_HNTCH_FREQ come out of flight logs),
//                         so they are computed but deliberately not asserted.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  applyStep,
  missingComponents,
  orderSteps,
  parameterDocsFrom,
  parseStepFile,
  requiredComponents,
  vehicleContext
} from '../packages/amc-steps/dist/index.js'

// ArduConfigurator already ships ArduPilot's parameter documentation, which the
// steps that set a parameter from a named value ('Quad', 'DShot600') need.
const DOCS_FOR = {
  ArduCopter: 'arducopter',
  ArduPlane: 'arduplane',
  Rover: 'ardurover',
  // The Heli sequence configures a helicopter frame on Copter firmware.
  Heli: 'arducopter'
}
const docs = new Map(
  Object.entries(DOCS_FOR).map(([vehicle, file]) => [
    vehicle,
    parameterDocsFrom(
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(`../apps/arduconfigurator/apps/web/src/generated/param-upstream/${file}.json`, import.meta.url)
          ),
          'utf8'
        )
      )
    )
  ])
)

const templatesDir = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', import.meta.url)
)
const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))
const VEHICLES = ['ArduCopter', 'ArduPlane', 'Rover', 'Heli']

// One template disagrees with the step file over a hard-coded constant. It is
// an upstream data inconsistency, not a computation: the step says 407517 and
// Holybro_X500's committed file says 407519. Pinned so the suite stays green
// while still failing if a *second* one ever appears.
const KNOWN_UPSTREAM_DISCREPANCIES = new Set([
  'ArduCopter/Holybro_X500/27_pid_notch_filter_logging.param/LOG_BITMASK'
])

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

function templatesFor(vehicle) {
  const dir = templatesDir + vehicle
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => ({ name, dir: `${dir}/${name}` }))
    .filter((t) => existsSync(`${t.dir}/vehicle_components.json`))
}

const sequences = new Map(
  VEHICLES.map((v) => [v, orderSteps(parseStepFile(readFileSync(`${stepsDir}configuration_steps_${v}.json`, 'utf8')))])
)

test('the runner reproduces every forced parameter in every template', () => {
  const mismatches = []
  let checked = 0
  let vehicles = 0

  for (const vehicle of VEHICLES) {
    for (const template of templatesFor(vehicle)) {
      vehicles += 1
      const defaults = `${template.dir}/00_default.param`
      const context = vehicleContext(
        readFileSync(`${template.dir}/vehicle_components.json`, 'utf8'),
        existsSync(defaults) ? readParamFile(defaults) : {}
      )

      for (const { filename, step } of sequences.get(vehicle)) {
        const produced = `${template.dir}/${filename}`
        // A template only ships the steps that vehicle went through.
        if (!existsSync(produced)) continue
        const expected = readParamFile(produced)
        const outcome = applyStep(step, context, { docs: docs.get(vehicle) })

        for (const change of outcome.changes) {
          if (change.group !== 'forced_parameters') continue
          const actual = expected[change.parameter]
          if (actual === undefined) continue
          const id = `${vehicle}/${template.name}/${filename}/${change.parameter}`
          if (KNOWN_UPSTREAM_DISCREPANCIES.has(id)) continue
          checked += 1
          const tolerance = Math.max(1e-6, Math.abs(change.value) * 1e-6)
          if (Math.abs(actual - change.value) > tolerance) {
            mismatches.push(`${id}: template has ${actual}, runner computed ${change.value}`)
          }
        }
      }
    }
  }

  assert.ok(vehicles >= 25, `only ${vehicles} templates found`)
  assert.ok(checked > 1000, `only ${checked} forced parameters checked`)
  assert.equal(
    mismatches.length,
    0,
    `${mismatches.length} of ${checked} forced parameters diverged:\n${mismatches.slice(0, 10).join('\n')}`
  )
})

// One named value in AMC's templates has no number behind it, and it is not a
// gap: FETtecOneWire is a *serial* ESC protocol, so MOT_PWM_TYPE -- which
// enumerates PWM output types -- has no value for it. AMC hits the same wall
// and skips the parameter, so reporting it is the faithful behaviour.
//
// The two that used to sit here were ours to fix and are fixed: INA2XX is
// documented as "INA2XX (INA226 INA228 ...)", which exact matching missed, and
// Plane carries the quadplane's Q_M_PWM_TYPE rather than MOT_PWM_TYPE.
const UNDOCUMENTED_VALUES = new Set([
  "MOT_PWM_TYPE: 'FETtecOneWire' is not one of its documented values"
])

function allFailures() {
  const failures = []
  for (const vehicle of VEHICLES) {
    for (const template of templatesFor(vehicle)) {
      const defaults = `${template.dir}/00_default.param`
      if (!existsSync(defaults)) continue
      const context = vehicleContext(
        readFileSync(`${template.dir}/vehicle_components.json`, 'utf8'),
        readParamFile(defaults)
      )
      for (const { filename, step } of sequences.get(vehicle)) {
        for (const failure of applyStep(step, context, { docs: docs.get(vehicle) }).failures) {
          failures.push({ vehicle, template: template.name, filename, ...failure })
        }
      }
    }
  }
  return failures
}

test('a vehicle that declares its hardware computes its whole sequence', () => {
  // The `empty_*` templates are blank starting points -- no propellers, no
  // battery -- so they are legitimately incomplete and excluded here.
  const unexplained = allFailures().filter(
    (f) =>
      !/^empty_/.test(f.template) &&
      // Plane, Rover and Heli sequences read Copter-only parameters without
      // guarding first; upstream tolerates this by logging, and so do we.
      f.errorType !== 'KeyError' &&
      !UNDOCUMENTED_VALUES.has(f.error)
  )
  assert.equal(
    unexplained.length,
    0,
    `${unexplained.length} unexplained failures:\n${unexplained.slice(0, 10).map((f) => `${f.vehicle}/${f.template}/${f.filename}: ${f.parameter} -> ${f.error}`).join('\n')}`
  )
})

test('every failure carries a diagnosis rather than being dropped', () => {
  const known = new Set(['KeyError', 'ZeroDivisionError', 'ValueError', 'TypeError', 'UnresolvableValueError'])
  for (const failure of allFailures()) {
    assert.ok(failure.error.length > 0, 'empty error message')
    assert.ok(failure.expression.length > 0, 'failure does not name its expression')
    assert.ok(known.has(failure.errorType), `unexpected error type ${failure.errorType}`)
  }
})

test('a blank template reports exactly what the operator has not declared', () => {
  const blank = templatesFor('ArduCopter').find((t) => t.name.startsWith('empty_'))
  assert.ok(blank, 'no blank template found')
  const steps = sequences.get('ArduCopter')
  const required = requiredComponents(steps.map((s) => s.step))
  const components = JSON.parse(readFileSync(`${blank.dir}/vehicle_components.json`, 'utf8')).Components

  // The blank template declares the component sections but leaves the values at
  // zero, so nothing is strictly *missing* -- which is why an unusable value
  // has to surface as a failure when the sequence runs, not just as a gap in
  // the form.
  const missing = missingComponents(components, required)
  const failures = allFailures().filter((f) => f.template === blank.name)
  assert.ok(
    missing.length > 0 || failures.length > 0,
    'a blank vehicle produced neither missing fields nor failures'
  )
  assert.ok(
    failures.some((f) => f.errorType === 'ZeroDivisionError'),
    'a zero propeller diameter should surface when the sequence runs'
  )
})

test("the named values ArduConfigurator's metadata lacks are the known three", () => {
  const unresolvable = new Set(
    allFailures().filter((f) => f.errorType === 'UnresolvableValueError').map((f) => f.error)
  )
  assert.deepEqual([...unresolvable].sort(), [...UNDOCUMENTED_VALUES].sort())
})

test('a missing component is reported, not thrown', () => {
  const step = {
    forced_parameters: {
      MOT_PWM_TYPE: { 'New Value': "vehicle_components['ESC']['FC->ESC Connection']['Protocol']", 'Change Reason': 'test' }
    }
  }
  const outcome = applyStep(step, vehicleContext('{"Components": {}}', {}))
  assert.equal(outcome.changes.length, 0)
  assert.equal(outcome.failures.length, 1)
  assert.equal(outcome.failures[0].errorType, 'KeyError')
  assert.equal(outcome.failures[0].parameter, 'MOT_PWM_TYPE')
})

test('the component fields the operator must supply are derived from the steps', () => {
  const required = requiredComponents(sequences.get('ArduCopter').map((s) => s.step))
  const rendered = required.map((r) => r.path.join(' > '))
  assert.ok(rendered.includes('Propellers > Specifications > Diameter_inches'), rendered.join('\n'))
  assert.ok(rendered.includes('Battery > Specifications > Number of cells'))
  assert.ok(rendered.includes('Flight Controller > Specifications > MCU Series'))
  // Sorted by how many expressions depend on the field.
  assert.ok(required[0].uses >= required.at(-1).uses)
  assert.ok(required.every((r) => r.path.length >= 2))
})
