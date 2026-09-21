// A parameter file that explains itself.
//
// A directory is something an operator opens months later, or hands to
// someone who did not configure the vehicle. `ATC_RAT_RLL_P,0.135` means
// nothing on its own.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { annotateParamFile, parseParamFile } from '../packages/amc-steps/dist/index.js'

const docs = (name) =>
  ({
    ATC_RAT_RLL_P: {
      label: 'Roll axis rate controller P gain',
      description: 'Roll axis rate controller P gain',
      minimum: 0.01,
      maximum: 0.5,
      units: 'd%'
    },
    LOG_BITMASK: {
      label: 'Log bitmask',
      description: 'Bitmap of what log types to enable',
      options: [
        { value: 1, label: 'Fast Attitude' },
        { value: 2, label: 'Medium Attitude' }
      ]
    },
    INS_TCAL1_ENABLE: { label: 'Temperature calibration enable', rebootRequired: true }
  })[name]

test('the documentation is written above the value', () => {
  const annotated = annotateParamFile('ATC_RAT_RLL_P,0.135\n', docs)
  assert.match(annotated, /# Roll axis rate controller P gain/)
  assert.match(annotated, /# Range: 0\.01 to 0\.5 · Units: d%/)
  assert.match(annotated, /ATC_RAT_RLL_P,0\.135/)
})

test('an annotated file still parses as an ordinary .param file', () => {
  // The thing that lets a directory be read back whether or not it was
  // annotated. If annotation broke parsing it would break reopening.
  const annotated = annotateParamFile('ATC_RAT_RLL_P,0.135  # why\nLOG_BITMASK,65535\n', docs)
  const entries = parseParamFile(annotated)
  assert.equal(entries.get('ATC_RAT_RLL_P').value, 0.135)
  assert.equal(entries.get('LOG_BITMASK').value, 65535)
  assert.equal(entries.size, 2)
})

test("a reboot requirement gets said, not buried", () => {
  // A value that does nothing until the vehicle restarts is the commonest way
  // a change looks like it failed.
  assert.match(annotateParamFile('INS_TCAL1_ENABLE,2\n', docs), /Reboot required/)
})

test('a parameter with no documentation is copied through untouched', () => {
  const annotated = annotateParamFile('MYSTERY_PARAM,7\n', docs)
  assert.equal(annotated, 'MYSTERY_PARAM,7\n')
})

test('the operator\'s own comment survives annotation', () => {
  // The reason the sequence gives is the point of the file; annotation adds
  // to it rather than replacing it.
  const annotated = annotateParamFile('ATC_RAT_RLL_P,0.135  # Tuned from a flight log\n', docs)
  assert.match(annotated, /# Tuned from a flight log/)
  assert.equal(parseParamFile(annotated).get('ATC_RAT_RLL_P').comment, 'Tuned from a flight log')
})

test('the file does not open with a blank line', () => {
  const annotated = annotateParamFile('ATC_RAT_RLL_P,0.135\nLOG_BITMASK,1\n', docs)
  assert.ok(!annotated.startsWith('\n'), 'a file opening with a blank line looks like it lost something')
  // But entries are separated, so the block above each value reads as its own.
  assert.match(annotated, /\n\n# Log bitmask/)
})

test('a long option list is capped rather than filling the file', () => {
  const many = (name) =>
    name === 'BIG'
      ? { label: 'Big', options: Array.from({ length: 30 }, (_, i) => ({ value: i, label: `Option ${i}` })) }
      : undefined
  const annotated = annotateParamFile('BIG,1\n', many)
  assert.match(annotated, /… 18 more/)
})

test('an empty file annotates to an empty file', () => {
  assert.equal(annotateParamFile('', docs), '')
})
