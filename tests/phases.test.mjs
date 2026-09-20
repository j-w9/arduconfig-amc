// The sequence's own phases.
//
// AMC groups its steps into phases, and the grouping is given in the step
// files' own numbering: a phase's `start` is a step *number* -- the prefix on
// `05_board_orientation.param` -- not a position in the list. The numbers have
// gaps, so the two are not interchangeable, and reading `start` as a position
// silently puts steps under the wrong heading.
//
// A phase with no `start` is not a range at all. "Assemble all components
// except the propellers" is something the operator does between steps and owns
// none of them; AMC excludes those from its phase ranges.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { milestonePhases, orderSteps, orderedPhases, parseStepFile, stepNumber } from '../packages/amc-steps/dist/index.js'

const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))
const files = readdirSync(stepsDir).filter((f) => f.startsWith('configuration_steps_') && !f.includes('schema'))
const load = (vehicle) => parseStepFile(readFileSync(`${stepsDir}configuration_steps_${vehicle}.json`, 'utf8'))

test('a phase starts at the step number it names, not the list position', () => {
  const file = load('ArduCopter')
  const steps = orderSteps(file)
  const byName = (name) => steps.find((s) => s.filename.startsWith(name))

  // Declared start: 2 and 5. Those are the 02_ and 05_ files.
  assert.equal(byName('02_')?.phase, 'IMU temperature calibration')
  assert.equal(byName('04_')?.phase, 'IMU temperature calibration')
  assert.equal(byName('05_')?.phase, 'Basic mandatory configuration')
  // The list position of 05_ is 3, so reading start as a position would have
  // put three later steps under the earlier heading.
  assert.equal(byName('05_')?.index, 3)
})

test('a phase without a start owns no steps', () => {
  const file = load('ArduCopter')
  const milestones = milestonePhases(file).map((m) => m.name)
  assert.ok(milestones.includes('Assemble all components except the propellers'))

  const spanning = orderedPhases(file).map((p) => p.name)
  for (const milestone of milestones) {
    assert.ok(!spanning.includes(milestone), `${milestone} should not span steps`)
  }
  // And no step is filed under one.
  for (const step of orderSteps(file)) {
    assert.ok(!milestones.includes(step.phase ?? ''), `${step.filename} filed under a milestone`)
  }
})

for (const fileName of files) {
  const vehicle = fileName.replace('configuration_steps_', '').replace('.json', '')
  const file = parseStepFile(readFileSync(stepsDir + fileName, 'utf8'))

  test(`${vehicle}: phases tile the sequence without overlapping`, () => {
    const phases = orderedPhases(file)
    assert.ok(phases.length > 0, 'no phases')
    for (let i = 1; i < phases.length; i += 1) {
      const previous = phases[i - 1]
      const current = phases[i]
      assert.ok(current.start > previous.start, `${current.name} starts before ${previous.name}`)
      // One ends exactly where the next begins: no gap, no overlap.
      assert.equal(previous.end, current.start, `${previous.name} does not meet ${current.name}`)
    }
    assert.ok(phases[phases.length - 1].end > phases[phases.length - 1].start)
  })

  test(`${vehicle}: every step within the phased range has a phase`, () => {
    const phases = orderedPhases(file)
    const first = phases[0].start
    for (const step of orderSteps(file)) {
      if (stepNumber(step.filename) < first) continue
      assert.ok(step.phase, `${step.filename} has no phase`)
      const phase = phases.find((p) => p.name === step.phase)
      const number = stepNumber(step.filename)
      assert.ok(
        phase && number >= phase.start && number < phase.end,
        `${step.filename} (${number}) is outside ${step.phase}`
      )
    }
  })

  test(`${vehicle}: the steps in a phase are contiguous in the list`, () => {
    // Rendering a phase as a heading over a run of steps only reads correctly
    // if the steps under it really are consecutive.
    const steps = orderSteps(file).filter((s) => s.phase)
    const seen = new Map()
    for (const step of steps) {
      const previous = seen.get(step.phase)
      if (previous !== undefined) {
        assert.equal(step.index, previous + 1, `${step.phase} is interrupted at ${step.filename}`)
      }
      seen.set(step.phase, step.index)
    }
  })
}
