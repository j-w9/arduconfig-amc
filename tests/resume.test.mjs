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
