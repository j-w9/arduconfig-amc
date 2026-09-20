// Running the sequence as a sequence.
//
// The steps are ordered and the order is load-bearing: a step sees the vehicle
// as the steps before it left it, not as it is now. The question these tests
// answer is whether that distinction is real on AMC's own vehicles or merely
// theoretical — because if it never changes an answer, threading is
// complexity with nothing to show for it.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  orderSteps,
  parameterDocsFrom,
  parameterValues,
  parseParamFile,
  parseStepFile,
  runThreaded,
  vehicleContext
} from '../packages/amc-steps/dist/index.js'

const templatesDir = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', import.meta.url)
)
const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))

const sequence = orderSteps(
  parseStepFile(readFileSync(`${stepsDir}configuration_steps_ArduCopter.json`, 'utf8'))
)
const docs = parameterDocsFrom(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../apps/arduconfigurator/apps/web/src/generated/param-upstream/arducopter.json', import.meta.url)),
      'utf8'
    )
  )
)

function templates() {
  return readdirSync(`${templatesDir}ArduCopter`)
    .map((name) => ({ name, dir: `${templatesDir}ArduCopter/${name}` }))
    .filter((t) => existsSync(`${t.dir}/vehicle_components.json`) && existsSync(`${t.dir}/00_default.param`))
}

function runFor(template) {
  const defaults = parameterValues(parseParamFile(readFileSync(`${template.dir}/00_default.param`, 'utf8')))
  const context = vehicleContext(readFileSync(`${template.dir}/vehicle_components.json`, 'utf8'), defaults)
  return { run: runThreaded(sequence, context, defaults, { docs }), defaults }
}

test('the ordering changes real answers on real vehicles', () => {
  // If this found nothing, threading would be machinery with no effect and the
  // honest thing would be to delete it.
  const withOrderDependence = templates().filter((t) => runFor(t).run.orderDependent.length > 0)
  assert.ok(
    withOrderDependence.length > 0,
    'no template had a single order-dependent step — threading would be pointless'
  )
})

test('a step that inherits a value names where it came from', () => {
  // "This differs" is not actionable. A step number is.
  const found = []
  for (const template of templates()) {
    for (const step of runFor(template).run.steps) {
      if (step.inheritedFrom.length > 0) found.push({ step: step.filename, from: step.inheritedFrom })
    }
  }
  assert.ok(found.length > 0, 'nothing inherited anything, on any vehicle')
  for (const entry of found) {
    for (const from of entry.from) {
      assert.ok(
        sequence.some((s) => s.filename === from),
        `${entry.step} claims to inherit from ${from}, which is not a step`
      )
      // A step cannot inherit from itself or from one that runs later.
      const here = sequence.findIndex((s) => s.filename === entry.step)
      const there = sequence.findIndex((s) => s.filename === from)
      assert.ok(there < here, `${entry.step} inherits from ${from}, which does not run before it`)
    }
  }
})

test('the run ends with the values the sequence decided, not the ones it started with', () => {
  const template = templates()[0]
  const { run, defaults } = runFor(template)

  const changed = Object.keys(run.parameters).filter((name) => run.parameters[name] !== defaults[name])
  assert.ok(changed.length > 0, 'the sequence left the vehicle exactly as it found it')

  // Every parameter any step set must be present at that step's value or a
  // later step's — never at the firmware default it started from.
  const lastValue = new Map()
  for (const step of run.steps) {
    for (const change of step.outcome.changes) lastValue.set(change.parameter, change.value)
  }
  for (const [name, value] of lastValue) {
    if (run.deleted.includes(name)) continue
    assert.equal(run.parameters[name], value, `${name} did not end at the value the last step to set it chose`)
  }
})

test('a deletion removes the parameter rather than zeroing it', () => {
  // A deleted parameter is one the vehicle should not have at all. Leaving it
  // at 0 would be a value, which is a different statement.
  const template = templates().find((t) => runFor(t).run.deleted.length > 0)
  if (!template) return // No Copter template deletes anything; nothing to assert.
  const { run } = runFor(template)
  for (const name of run.deleted) {
    assert.ok(!(name in run.parameters), `${name} was deleted but is still present`)
  }
})

test('threading is what makes a later step see an earlier step\'s value', () => {
  // The mechanism, stated directly rather than inferred from a template: step
  // two reads what step one set, and can only get the right answer if the
  // first step's change reached it.
  const steps = [
    {
      filename: '01_first.param',
      step: { forced_parameters: { FOO: { 'New Value': '7', 'Change Reason': 'first' } } }
    },
    {
      filename: '02_second.param',
      step: { forced_parameters: { BAR: { 'New Value': "fc_parameters['FOO'] * 2", 'Change Reason': 'reads FOO' } } }
    }
  ]
  const context = vehicleContext('{"Components": {}}', { FOO: 1, BAR: 0 })
  const run = runThreaded(steps, context, { FOO: 1, BAR: 0 })

  const second = run.steps[1].outcome.changes.find((c) => c.parameter === 'BAR')
  assert.equal(second.value, 14, 'the second step did not see the first step\'s value')
  assert.deepEqual(run.steps[1].inheritedFrom, ['01_first.param'])
  assert.deepEqual(run.orderDependent, ['02_second.param'])
  assert.equal(run.parameters.BAR, 14)
})
