// What is on the aircraft that the sequence did not decide.
//
// The directory says what the method decided. An operator finishing the
// sequence is left with "is that everything?", and the honest answer is
// usually no: a value someone set by hand, a tab elsewhere in this app, an
// earlier configuration nobody wrote down. Without this the directory quietly
// implies it describes the whole vehicle.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  orderSteps,
  parseParamFile,
  parseStepFile,
  unaccountedParameters,
  vehicleContext,
  vehicleFiles
} from '../packages/amc-steps/dist/index.js'

const sequence = orderSteps(
  parseStepFile(
    readFileSync(fileURLToPath(new URL('../steps/configuration_steps_ArduCopter.json', import.meta.url)), 'utf8')
  )
)

/** The files the sequence would write for a minimally declared vehicle. */
const files = vehicleFiles(
  sequence,
  vehicleContext('{"Components": {"Propellers": {"Specifications": {"Diameter_inches": 10}}}}', {})
)

const namesIn = (file) => [...parseParamFile(file.text).keys()]

test('a parameter no step sets is reported, and says so', () => {
  const file = unaccountedParameters(files, { SOME_HAND_SET_THING: 7 })
  assert.deepEqual(namesIn(file), ['SOME_HAND_SET_THING'])
  assert.match(file.text, /Not set by any step/)
})

test('a parameter a step sets, at that value, is not reported', () => {
  // It is accounted for: the method decided it and the vehicle agrees.
  const setByStep = parseParamFile(files.find((f) => f.count > 0).text)
  const [name, entry] = [...setByStep.entries()][0]
  const file = unaccountedParameters(files, { [name]: entry.value })
  assert.deepEqual(namesIn(file), [])
})

test('a parameter a step sets, at a DIFFERENT value, is reported with the step\'s value', () => {
  // This is the interesting case: the vehicle disagrees with the method, and
  // saying only "unaccounted" would lose why it matters.
  const setByStep = parseParamFile(files.find((f) => f.count > 0).text)
  const [name, entry] = [...setByStep.entries()][0]
  const file = unaccountedParameters(files, { [name]: entry.value + 5 })
  assert.deepEqual(namesIn(file), [name])
  assert.match(file.text, new RegExp(`A step sets this to ${entry.value}`))
})

test('a value still at its firmware default is not reported', () => {
  // Nobody chose it, so there is nothing for the sequence to have missed.
  const file = unaccountedParameters(files, { UNTOUCHED: 3 }, { defaults: new Map([['UNTOUCHED', 3]]) })
  assert.deepEqual(namesIn(file), [])

  // But one moved away from its default is exactly what this is for.
  const moved = unaccountedParameters(files, { UNTOUCHED: 4 }, { defaults: new Map([['UNTOUCHED', 3]]) })
  assert.deepEqual(namesIn(moved), ['UNTOUCHED'])
})

test('boot-time calibration results are left out', () => {
  // These are the vehicle's own writing, produced by a calibration rather
  // than chosen by anyone — and an accelerometer offset belongs to the
  // airframe that was calibrated, not to a file that might be replayed.
  const file = unaccountedParameters(files, {
    INS_ACCOFFS_X: 0.12,
    INS_GYROFFS_Y: 0.003,
    COMPASS_DEC: 0.05,
    SOMETHING_ELSE: 1
  })
  assert.deepEqual(namesIn(file), ['SOMETHING_ELSE'])
})

test('the defaults file is not treated as a step', () => {
  // 00_default.param records what the firmware ships with, not what the
  // method decided; counting it would mark the whole vehicle as accounted for.
  const withDefaults = [...files, { filename: '00_default.param', text: 'ONLY_IN_DEFAULTS,9\n', count: 1, incomplete: 0 }]
  const file = unaccountedParameters(withDefaults, { ONLY_IN_DEFAULTS: 9 })
  assert.deepEqual(namesIn(file), ['ONLY_IN_DEFAULTS'])
})

test('a float that differs only by rounding is the same value', () => {
  const setByStep = parseParamFile(files.find((f) => f.count > 0).text)
  const [name, entry] = [...setByStep.entries()][0]
  const file = unaccountedParameters(files, { [name]: entry.value + entry.value * 1e-9 })
  assert.deepEqual(namesIn(file), [])
})

test('the result is sorted, so two exports of the same vehicle diff to nothing', () => {
  const file = unaccountedParameters(files, { ZZZ_LAST: 1, AAA_FIRST: 2, MMM_MID: 3 })
  assert.deepEqual(namesIn(file), ['AAA_FIRST', 'MMM_MID', 'ZZZ_LAST'])
})
