// What the aircraft held before any of this touched it.
//
// AMC writes two snapshots of the flight controller's parameters into the
// vehicle directory. The first is taken once and never again, so it records
// the vehicle as it was before the method ran — which is what you want back
// when a configuration turns out wrong and the tuning that flew is two weeks
// of edits ago. Neither file is a step and neither is read back: they exist
// for the moment something has gone wrong, which is exactly when regenerating
// them is no longer possible.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FIRST_BACKUP,
  MAX_BACKUP,
  backupFiles,
  nextBackupNumber,
  parseParamFile,
  readVehicleProject
} from '../packages/amc-steps/dist/index.js'

const VEHICLE = { ATC_RAT_RLL_P: 0.135, LOG_BITMASK: 176126, INS_GYRO_FILTER: 20 }

test('a fresh directory gets the before-anything snapshot and the first numbered one', () => {
  const files = backupFiles(VEHICLE)
  assert.deepEqual(files.map((file) => file.filename), [FIRST_BACKUP, 'autobackup_01.param'])
  for (const file of files) {
    assert.equal(file.count, 3)
    assert.equal(parseParamFile(file.text).get('LOG_BITMASK').value, 176126)
  }
})

test('the before-anything snapshot is never taken twice', () => {
  // Taking it again would overwrite the only record of the original vehicle
  // with a record of the vehicle as this tool has already left it.
  const files = backupFiles(VEHICLE, { existing: [FIRST_BACKUP, 'autobackup_01.param'] })
  assert.deepEqual(files.map((file) => file.filename), ['autobackup_02.param'])
})

test('a directory already worked in gets no before-anything snapshot', () => {
  // AMC checks for last_uploaded_filename.txt. By then the vehicle has been
  // written to, so a snapshot of it is not a snapshot of what was there first.
  const files = backupFiles(VEHICLE, { alreadyStarted: true })
  assert.deepEqual(files.map((file) => file.filename), ['autobackup_01.param'])
})

test('each session takes the next free number', () => {
  assert.equal(nextBackupNumber([]), 1)
  assert.equal(nextBackupNumber(['autobackup_01.param']), 2)
  assert.equal(nextBackupNumber(['autobackup_01.param', 'autobackup_02.param']), 3)
  // A gap is filled rather than skipped past, which is AMC's behaviour: it
  // counts up from 01 and stops at the first name that is free.
  assert.equal(nextBackupNumber(['autobackup_02.param']), 1)
})

test('the numbering stops rather than filling the directory forever', () => {
  const full = new Set()
  for (let i = 1; i <= MAX_BACKUP; i += 1) {
    full.add(`autobackup_${String(i).padStart(2, '0')}.param`)
  }
  // At the cap AMC overwrites the highest, which is the choice this follows.
  assert.equal(nextBackupNumber(full), MAX_BACKUP)
})

test('a vehicle that has reported nothing is not snapshotted', () => {
  // An empty backup would assert that the aircraft was blank, which is a
  // stronger and more misleading claim than the file's absence.
  assert.deepEqual(backupFiles({}), [])
  assert.deepEqual(backupFiles({}, { alreadyStarted: true }), [])
})

test('the snapshot is a plain parameter file, in a stable order', () => {
  // It has to be readable by anything that reads a .param file — Mission
  // Planner, AMC itself, a text editor at 2am.
  const [first] = backupFiles(VEHICLE)
  const names = [...parseParamFile(first.text).keys()]
  assert.deepEqual(names, [...names].sort())
  // Written twice, byte for byte the same: a backup that churns is a backup
  // nobody can diff.
  assert.equal(backupFiles(VEHICLE)[0].text, first.text)
})

test('no reason is attached to a backed-up value', () => {
  // These are not decisions and carry no justification — they are what the
  // vehicle happened to hold. AMC exports them with an empty comment.
  const [first] = backupFiles(VEHICLE)
  assert.equal(parseParamFile(first.text).get('ATC_RAT_RLL_P').comment, undefined)
})

test('a backup is not reported back as work left unread', () => {
  // The directory's own bookkeeping, not a step. Reporting one as unread would
  // tell the operator their work was dropped when nothing of the sort happened
  // — exactly what a retired step file used to do before the migration landed.
  const project = readVehicleProject(
    [],
    [
      { filename: FIRST_BACKUP, text: 'ATC_RAT_RLL_P,0.135\n' },
      { filename: 'autobackup_07.param', text: 'ATC_RAT_RLL_P,0.135\n' }
    ]
  )
  assert.deepEqual(project.unmatched, [])
})
