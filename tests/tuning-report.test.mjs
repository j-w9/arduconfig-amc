// How the tuning moved, step by step.
//
// Tuning is the long part of the method — an initial guess, a quick-tune,
// then autotune for roll, pitch and yaw, each overwriting the last. The one
// question an operator asks is "did this get better, and when?", and the
// per-step files make that a matter of opening nine files side by side.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { hasTuningHistory, parseParamFile, tuningReport } from '../packages/amc-steps/dist/index.js'

const file = (filename, text) => ({ filename, text, count: 1, incomplete: 0 })

// Python's csv module ends every row with CRLF, and so does AMC's report.
const rows = (csv) => csv.text.trim().split('\r\n').map((line) => line.split(','))

test('a row per gain, a column per tuning step, default first', () => {
  const csv = tuningReport(
    [
      file('13_initial_atc.param', 'ATC_RAT_RLL_P,0.135\n'),
      file('40_autotune_roll_results.param', 'ATC_RAT_RLL_P,0.201\n')
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
  assert.equal(row[table[0].indexOf('40_autotune_roll_results.param')], '0.201')
})

test('a step that changed nothing leaves its cell empty', () => {
  // Carrying the previous value forward would invent a decision no step made.
  // The file records what each step CHANGED.
  const csv = tuningReport([file('13_initial_atc.param', 'ATC_RAT_RLL_P,0.135\n')])
  const table = rows(csv)
  const row = table.find((line) => line[0] === 'ATC_RAT_RLL_P')
  assert.equal(row[table[0].indexOf('34_quick_tune_results.param')], '')
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
  assert.equal(hasTuningHistory([file('15_board_orientation.param', 'AHRS_ORIENTATION,0\n')]), false)
  assert.equal(hasTuningHistory([file('13_initial_atc.param', 'ATC_RAT_RLL_P,0.135\n')]), true)
  assert.equal(hasTuningHistory([], new Map([['ATC_RAT_RLL_P', 0.135]])), true)
})

test('it is real CSV, with anything awkward quoted', () => {
  const csv = tuningReport([file('13_initial_atc.param', 'ATC_RAT_RLL_P,0.135\n')])
  assert.match(csv.filename, /^tuning_report\.csv$/)
  for (const line of rows(csv)) {
    assert.equal(line.length, 10, `a row has ${line.length} cells, not 10`)
  }
  assert.ok(csv.text.endsWith('\r\n'))
})

test('the columns follow the vehicle, as AMC 5.0.0 has them', () => {
  // The sequence was renumbered, and Heli's tuning became steps of its own.
  const header = (vehicle) => rows(tuningReport([], undefined, vehicle))[0]
  assert.ok(header('ArduCopter').includes('34_quick_tune_results.param'))
  assert.ok(header('Rover').includes('17_initial_atc.param'))
  assert.ok(header('Heli').includes('43_autotune_roll_pitch_ff_results.param'))
  // Heli also watches its feed-forward gains.
  assert.ok(rows(tuningReport([], undefined, 'Heli')).some((line) => line[0] === 'ATC_RAT_YAW_FF'))
  assert.ok(!rows(tuningReport([], undefined, 'ArduCopter')).some((line) => line[0] === 'ATC_RAT_YAW_FF'))
})

test('every template gets exactly the report AMC writes for it', () => {
  // AMC's own _update_tuning_report, run under CPython on every template it
  // ships (scripts/gen_tuning_report_fixture.py).
  const here = (name) => fileURLToPath(new URL(name, import.meta.url))
  const fixture = JSON.parse(readFileSync(here('./fixtures/tuning-report.json'), 'utf8'))
  const base = here('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/')
  assert.ok(fixture.cases.length >= 29)
  const problems = []
  for (const c of fixture.cases) {
    const dir = `${base}${c.template}`
    const files = readdirSync(dir)
      .filter((name) => /^\d\d_.*\.param$/.test(name) && name !== '00_default.param')
      .map((name) => file(name, readFileSync(`${dir}/${name}`, 'utf8')))
    const defaultsPath = `${dir}/00_default.param`
    const defaults = existsSync(defaultsPath)
      ? new Map([...parseParamFile(readFileSync(defaultsPath, 'utf8'))].map(([name, entry]) => [name, entry.value]))
      : undefined
    const ours = tuningReport(files, defaults, c.vehicleType).text
    if (ours !== c.csv) problems.push(c.template)
  }
  assert.deepEqual(problems, [])
})
