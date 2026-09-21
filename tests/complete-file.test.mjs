// Every value the sequence decided, in one file.
//
// AMC writes this as complete.param. It answers what the per-step files
// cannot: what does the method say this vehicle should be, all told?

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  completeFile,
  orderSteps,
  parseParamFile,
  parseStepFile,
  vehicleContext,
  vehicleFiles
} from '../packages/amc-steps/dist/index.js'

const sequence = orderSteps(
  parseStepFile(
    readFileSync(fileURLToPath(new URL('../steps/configuration_steps_ArduCopter.json', import.meta.url)), 'utf8')
  )
)
const files = vehicleFiles(
  sequence,
  vehicleContext('{"Components": {"Propellers": {"Specifications": {"Diameter_inches": 10}}}}', {})
)

test('the LAST step to set a parameter is the one that decides it', () => {
  // Half a dozen steps touch LOG_BITMASK. Taking the first would describe a
  // vehicle the method never intended.
  const ordered = [
    { filename: '01_a.param', text: 'LOG_BITMASK,1\n', count: 1, incomplete: 0 },
    { filename: '02_b.param', text: 'LOG_BITMASK,2\n', count: 1, incomplete: 0 },
    { filename: '03_c.param', text: 'LOG_BITMASK,3\n', count: 1, incomplete: 0 }
  ]
  const entries = parseParamFile(completeFile(ordered).text)
  assert.equal(entries.get('LOG_BITMASK').value, 3)
  // And it says which step settled it, which a compounded file otherwise loses.
  assert.match(entries.get('LOG_BITMASK').comment, /03_c\.param/)
})

test('the firmware defaults are not decisions', () => {
  const withDefaults = [
    { filename: '00_default.param', text: 'ONLY_DEFAULT,9\n', count: 1, incomplete: 0 },
    { filename: '01_a.param', text: 'CHOSEN,1\n', count: 1, incomplete: 0 }
  ]
  const entries = parseParamFile(completeFile(withDefaults).text)
  assert.equal(entries.has('ONLY_DEFAULT'), false)
  assert.equal(entries.has('CHOSEN'), true)
})

test('a recorded decision survives into the compounded file', () => {
  // @manual_override is the operator overruling the sequence; a summary that
  // dropped the marker would make their choice look like the method's.
  const overridden = [
    { filename: '01_a.param', text: 'LOG_BITMASK,407519  # @manual_override kept for notch tuning\n', count: 1, incomplete: 0 }
  ]
  const file = completeFile(overridden)
  assert.match(file.text, /@manual_override/)
  assert.equal(parseParamFile(file.text).get('LOG_BITMASK').manualOverride, true)
})

test('it holds every parameter the sequence set, once each', () => {
  const file = completeFile(files)
  const names = [...parseParamFile(file.text).keys()]
  assert.equal(new Set(names).size, names.length, 'a parameter appears more than once')

  const everySet = new Set()
  for (const stepFile of files) for (const name of parseParamFile(stepFile.text).keys()) everySet.add(name)
  assert.deepEqual([...everySet].sort(), [...names].sort())
  assert.ok(names.length > 20, `only ${names.length} parameters compounded`)
})

test('it is sorted, so two exports of the same vehicle diff to nothing', () => {
  const names = [...parseParamFile(completeFile(files).text).keys()]
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)))
})
