// How the tuning moved, step by step.
//
// Tuning is the long part of the method — an initial guess, a quick-tune,
// then autotune for roll, pitch and yaw, each overwriting the last. The one
// question an operator asks is "did this get better, and when?", and the
// per-step files make that a matter of opening nine files side by side.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hasTuningHistory, tuningReport } from '../packages/amc-steps/dist/index.js'

const file = (filename, text) => ({ filename, text, count: 1, incomplete: 0 })

const rows = (csv) => csv.text.trim().split('\n').map((line) => line.split(','))

test('a row per gain, a column per tuning step, default first', () => {
  const csv = tuningReport(
    [
      file('13_initial_atc.param', 'ATC_RAT_RLL_P,0.135\n'),
      file('36_autotune_roll_results.param', 'ATC_RAT_RLL_P,0.201\n')
    ],
    new Map([['ATC_RAT_RLL_P', 0.135]])
  )
  const table = rows(csv)
  assert.equal(table[0][0], 'param')
  assert.equal(table[0][1], '00_default.param')

  const row = table.find((line) => line[0] === 'ATC_RAT_RLL_P')
  // Reading across the row IS the history of that gain.
  assert.equal(row[1], '0.135', 'the firmware default')
  assert.equal(row[table[0].indexOf('13_initial_atc.param')], '0.135')
  assert.equal(row[table[0].indexOf('36_autotune_roll_results.param')], '0.201')
})

test('a step that changed nothing leaves its cell empty', () => {
  // Carrying the previous value forward would invent a decision no step made.
  // The file records what each step CHANGED.
  const csv = tuningReport([file('13_initial_atc.param', 'ATC_RAT_RLL_P,0.135\n')])
  const table = rows(csv)
  const row = table.find((line) => line[0] === 'ATC_RAT_RLL_P')
  assert.equal(row[table[0].indexOf('30_quick_tune_results.param')], '')
})

test('every gain AMC watches has a row, even an untouched one', () => {
  // An absent row would read as "this was never tuned"; an empty one says
  // "nothing moved it", which is the true statement.
  const table = rows(tuningReport([]))
  assert.equal(table.length - 1, 26)
  for (const gain of ['ATC_RAT_RLL_P', 'ATC_RAT_YAW_D', 'INS_GYRO_FILTER', 'ATC_ACCEL_Y_MAX']) {
    assert.ok(table.some((line) => line[0] === gain), `${gain} has no row`)
  }
})

test('a vehicle with no tuning history is not given an empty report', () => {
  // A grid of 26 blank rows says nothing, and a file that says nothing is
  // worse than one that is absent.
  assert.equal(hasTuningHistory([], undefined), false)
  assert.equal(hasTuningHistory([file('05_board_orientation.param', 'AHRS_ORIENTATION,0\n')]), false)
  assert.equal(hasTuningHistory([file('13_initial_atc.param', 'ATC_RAT_RLL_P,0.135\n')]), true)
  assert.equal(hasTuningHistory([], new Map([['ATC_RAT_RLL_P', 0.135]])), true)
})

test('it is real CSV, with anything awkward quoted', () => {
  const csv = tuningReport([file('13_initial_atc.param', 'ATC_RAT_RLL_P,0.135\n')])
  assert.match(csv.filename, /^tuning_report\.csv$/)
  for (const line of rows(csv)) {
    assert.equal(line.length, 10, `a row has ${line.length} cells, not 10`)
  }
  assert.ok(csv.text.endsWith('\n'))
})
