// The vendored sequence must load, stay ordered, and contain nothing the
// expression parser cannot read -- checked before any of it reaches a vehicle.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { parse } from '../packages/amc-expr/dist/index.js'
import { VALUED_GROUPS, directivesOf, expressionsOf, orderSteps, parseStepFile } from '../packages/amc-steps/dist/index.js'

const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))
const files = readdirSync(stepsDir).filter((f) => f.startsWith('configuration_steps_') && !f.includes('schema'))

test('all four vehicle sequences load', () => {
  assert.deepEqual(
    files.slice().sort(),
    ['configuration_steps_ArduCopter.json', 'configuration_steps_ArduPlane.json', 'configuration_steps_Heli.json', 'configuration_steps_Rover.json']
  )
})

for (const file of files) {
  const vehicle = file.replace('configuration_steps_', '').replace('.json', '')
  const parsed = parseStepFile(readFileSync(stepsDir + file, 'utf8'))
  const ordered = orderSteps(parsed)

  test(`${vehicle}: steps are ordered by their filename prefix`, () => {
    assert.ok(ordered.length > 0, 'no steps')
    const numbers = ordered.map((s) => Number(/^(\d+)/.exec(s.filename)?.[1] ?? -1))
    for (let i = 1; i < numbers.length; i += 1) {
      assert.ok(numbers[i] >= numbers[i - 1], `${ordered[i].filename} follows ${ordered[i - 1].filename}`)
    }
    assert.deepEqual(ordered.map((s) => s.index), ordered.map((_, i) => i))
  })

  test(`${vehicle}: every expression parses`, () => {
    let count = 0
    for (const { filename, step } of ordered) {
      for (const expression of expressionsOf(step)) {
        count += 1
        assert.doesNotThrow(() => parse(expression), `${filename}: ${expression}`)
      }
    }
    assert.ok(count > 0, 'no expressions found')
  })

  test(`${vehicle}: derived and forced parameters always state a value`, () => {
    for (const { filename, step } of ordered) {
      for (const { group, parameter, directive } of directivesOf(step)) {
        // add_parameters may take its value from the step's own .param file,
        // and a delete has nothing to set -- but these two always say.
        if (!VALUED_GROUPS.includes(group)) continue
        const value = directive['New Value']
        assert.ok(
          typeof value === 'string' || typeof value === 'number',
          `${filename}: ${group}.${parameter} has no New Value`
        )
      }
    }
  })

  test(`${vehicle}: a delete never also sets a value`, () => {
    for (const { filename, step } of ordered) {
      for (const { group, parameter, directive } of directivesOf(step)) {
        if (group !== 'delete_parameters') continue
        assert.equal(directive['New Value'], undefined, `${filename}: deletes ${parameter} and sets it`)
      }
    }
  })
}
