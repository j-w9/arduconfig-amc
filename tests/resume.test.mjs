// Where to pick the sequence up again.
//
// AMC's method runs over days: cool the controller overnight for the
// temperature calibration, fly it, come back for the notch filters. Losing
// your place is a real cost, and "start over" is a surprising answer.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  LAST_WRITTEN_FILENAME,
  lastWrittenFile,
  lastWrittenFrom,
  orderSteps,
  parseStepFile,
  resumePoint
} from '../packages/amc-steps/dist/index.js'

const sequence = orderSteps(
  parseStepFile(
    readFileSync(fileURLToPath(new URL('../steps/configuration_steps_ArduCopter.json', import.meta.url)), 'utf8')
  )
)

test('resuming opens the step AFTER the one last written', () => {
  // Resuming AT it invites writing it twice, and a step already applied and
  // rebooted through is done — the next question is what comes next.
  const third = sequence[2].filename
  const point = resumePoint(sequence, sequence[1].filename)
  assert.equal(point.filename, third)
  assert.equal(point.reason, 'after-last-written')
  assert.equal(point.lastWritten, sequence[1].filename)
})

test('a directory that recorded nothing starts at the beginning', () => {
  for (const nothing of [undefined, '', '   ']) {
    const point = resumePoint(sequence, nothing)
    assert.equal(point.filename, sequence[0].filename)
    assert.equal(point.reason, 'fresh')
  }
})

test('a finished sequence says so rather than starting over', () => {
  const point = resumePoint(sequence, sequence.at(-1).filename)
  assert.equal(point.filename, undefined)
  assert.equal(point.reason, 'finished')
  assert.equal(point.lastWritten, sequence.at(-1).filename)
})

test('a step renamed since the directory was written still resumes', () => {
  // This is the case that matters. A directory from an older AMC records a
  // name this sequence has changed, and calling it unrecognised would send an
  // operator back to the start of a sequence they had nearly finished.
  const renamed = sequence.find((entry) => (entry.step.old_filenames ?? []).length > 0)
  assert.ok(renamed, 'the sequence carries no renamed step to test')
  const oldName = renamed.step.old_filenames[0]

  const point = resumePoint(sequence, oldName)
  assert.equal(point.reason, 'after-last-written')
  assert.equal(point.lastWritten, renamed.filename, 'the old name should resolve to its current step')
  const index = sequence.findIndex((entry) => entry.filename === renamed.filename)
  assert.equal(point.filename, sequence[index + 1].filename)
})

test('a name from no sequence at all is reported, not silently ignored', () => {
  const point = resumePoint(sequence, '99_from_another_vehicle.param')
  assert.equal(point.filename, sequence[0].filename)
  assert.equal(point.reason, 'unrecognised')
  assert.equal(point.lastWritten, undefined)
})

test('an empty sequence has nothing to resume', () => {
  assert.deepEqual(resumePoint([], '02_something.param'), { reason: 'fresh' })
})

test('the file written is the one AMC reads, newline and all', () => {
  const file = lastWrittenFile('13_initial_atc.param')
  assert.equal(file.filename, LAST_WRITTEN_FILENAME)
  assert.equal(file.text, '13_initial_atc.param\n')
})

test('reading it back tolerates a path and surrounding whitespace', () => {
  // A directory picker hands over paths; an editor may have added a newline.
  assert.equal(
    lastWrittenFrom([{ filename: 'MyCopter/last_uploaded_filename.txt', text: ' 13_initial_atc.param \n' }]),
    '13_initial_atc.param'
  )
  assert.equal(lastWrittenFrom([{ filename: LAST_WRITTEN_FILENAME, text: '  \n' }]), undefined)
  assert.equal(lastWrittenFrom([{ filename: '02_step.param', text: 'x' }]), undefined)
})

test('what is written is what reads back', () => {
  const written = lastWrittenFile(sequence[5].filename)
  assert.equal(lastWrittenFrom([written]), sequence[5].filename)
  assert.equal(resumePoint(sequence, lastWrittenFrom([written])).filename, sequence[6].filename)
})

test('a firmware without the temperature calibration opens past it', () => {
  // ArduPilot leaves the IMU temperature calibration out on boards short of
  // flash. AMC tests for it by name — "INS_TCAL1_ENABLE" in fc_parameters —
  // and opens a fresh directory two steps in rather than on a calibration the
  // vehicle can never perform.
  const point = resumePoint(sequence, undefined, { supportsTemperatureCalibration: false })
  assert.equal(point.reason, 'fresh-no-tempcal')
  assert.equal(point.filename, sequence[2].filename)
  // And that really is past both calibration steps.
  assert.match(sequence[0].filename, /imu_temperature_calibration/)
  assert.match(sequence[1].filename, /imu_temperature_calibration/)
  assert.doesNotMatch(point.filename, /imu_temperature_calibration_setup|_results/)
})

test('a firmware that has it opens at the start, and so does an unknown one', () => {
  // AMC's own check is true when there are no parameters at all: a tab opened
  // on the bench should show the sequence from its beginning.
  for (const options of [{ supportsTemperatureCalibration: true }, {}]) {
    const point = resumePoint(sequence, undefined, options)
    assert.equal(point.reason, 'fresh')
    assert.equal(point.filename, sequence[0].filename)
  }
})

test('a recorded position beats the temperature-calibration rule', () => {
  // The rule is about where to START. An operator who has got somewhere is
  // owed their place back regardless of what the firmware supports.
  const point = resumePoint(sequence, sequence[4].filename, {
    supportsTemperatureCalibration: false
  })
  assert.equal(point.reason, 'after-last-written')
  assert.equal(point.filename, sequence[5].filename)
})

test('a sequence too short to skip into still opens somewhere', () => {
  const tiny = sequence.slice(0, 2)
  const point = resumePoint(tiny, undefined, { supportsTemperatureCalibration: false })
  assert.equal(point.filename, tiny[tiny.length - 1].filename)
})
