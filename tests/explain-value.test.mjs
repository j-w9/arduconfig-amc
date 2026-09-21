// Saying what a value means, not just what it is.
//
// The sequence sets LOG_BITMASK to 176126. Shown as that number the operator
// cannot tell what is about to happen to their aircraft, which defeats a
// method whose whole claim is that every value carries its reason.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { explainValue, parameterDocsFrom } from '../packages/amc-steps/dist/index.js'

// ArduPilot's own metadata, as the app generates it — not a fixture written
// here, so the labels are the ones an operator actually sees.
const docs = parameterDocsFrom(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../apps/arduconfigurator/apps/web/src/generated/param-upstream/arducopter.json', import.meta.url)
      ),
      'utf8'
    )
  )
)

test('a documented choice is named', () => {
  // The sequence writes MOT_PWM_TYPE 6; "DShot600" is the thing worth reading.
  const explained = explainValue('MOT_PWM_TYPE', 6, docs)
  assert.equal(explained.kind, 'choice')
  assert.match(explained.summary, /DShot/)
})

test('a bitmask is decomposed into the bits it actually sets', () => {
  // Bitmask options are keyed by BIT INDEX, choices by the value itself. The
  // two are indistinguishable in the metadata, so reading one as the other
  // would produce a confident and wrong answer.
  // Bits 0 and 2, which ArduCopter names Fast Attitude and GPS.
  const explained = explainValue('LOG_BITMASK', 1 | (1 << 2), docs)
  assert.equal(explained.kind, 'bitmask')
  assert.deepEqual(explained.bits, ['Fast Attitude', 'GPS'])
})

test('the real value the sequence uses comes out readable', () => {
  const explained = explainValue('LOG_BITMASK', 176126, docs)
  assert.equal(explained.kind, 'bitmask')
  assert.ok(explained.bits.length > 3, 'this mask sets a lot of bits')
  // Summarised rather than listed in full: a dozen names in a table cell is
  // not more legible than the number was.
  assert.match(explained.summary, /of \d+:/)
})

test('an empty mask says so rather than looking like a failure', () => {
  assert.equal(explainValue('LOG_BITMASK', 0, docs).summary, 'nothing set')
})

test('a value the documentation does not cover gets no explanation', () => {
  // A wrong explanation of a logging mask is worse than none.
  assert.equal(explainValue('MOT_PWM_TYPE', 999, docs), undefined)
  assert.equal(explainValue('ATC_RAT_RLL_P', 0.135, docs), undefined)
  assert.equal(explainValue('NOT_A_PARAMETER', 1, docs), undefined)
  assert.equal(explainValue('MOT_PWM_TYPE', 6, undefined), undefined)
})

test('a mask set entirely to bits nobody named explains nothing', () => {
  // Reporting "0 of 32" would be a statement about the documentation, not
  // about the vehicle.
  const explained = explainValue('LOG_BITMASK', 1 << 30, docs)
  assert.equal(explained, undefined)
})

test('bits beyond the documented ones are counted, not hidden', () => {
  const explained = explainValue('LOG_BITMASK', 1 | (1 << 30), docs)
  assert.match(explained.summary, /and 1 more/)
})

test('a value that is not a whole mask is left alone', () => {
  // Decomposing these would invent bits that are not there.
  assert.equal(explainValue('LOG_BITMASK', -1, docs), undefined)
  assert.equal(explainValue('LOG_BITMASK', 1.5, docs), undefined)
  // Past 2^31 the bitwise operators wrap, so the answer would be wrong rather
  // than merely incomplete.
  assert.equal(explainValue('LOG_BITMASK', 2 ** 32, docs), undefined)
})
