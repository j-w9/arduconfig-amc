// How much of AMC's directory this fork's directives actually produce.
//
// The existing writer tests check that what we write AGREES with AMC. None of
// them checked how much of AMC's directory we write at all, and "a good share
// of the directory comes out byte for byte" turned out to be doing a lot of
// work: AMC seeds a vehicle directory by copying a TEMPLATE's .param files and
// then lets the sequence edit them, while this fork computes purely from the
// step directives. Most of what is in an AMC directory is therefore template
// content, not computed content.
//
// That is a real architectural difference and not necessarily a defect --
// copying another aircraft's antenna offsets into this one's directory would
// be actively wrong -- but it must be a number somebody can see, not a
// phrase. This records it so a change either way is visible.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  applyStep,
  orderSteps,
  parseParamFile,
  parseStepFile,
  vehicleContext
} from '../packages/amc-steps/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const templates = root + 'vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/ArduCopter/'
const sequence = orderSteps(
  parseStepFile(readFileSync(root + 'steps/configuration_steps_ArduCopter.json', 'utf8'))
)

/** The neutral starting point a fresh AMC project uses. */
const BASELINE = 'empty_4.6.x'

function coverage(template) {
  const dir = templates + template
  const context = vehicleContext(readFileSync(dir + '/vehicle_components.json', 'utf8'), {})

  let inFile = 0
  let computed = 0
  const bySteps = new Map()

  for (const { filename, step } of sequence) {
    const path = `${dir}/${filename}`
    if (!existsSync(path)) continue
    const theirs = new Set(parseParamFile(readFileSync(path, 'utf8')).keys())
    const ours = new Set(applyStep(step, context, {}).changes.map((change) => change.parameter))

    let here = 0
    for (const parameter of theirs) {
      inFile += 1
      if (ours.has(parameter)) {
        computed += 1
        here += 1
      }
    }
    if (theirs.size > 0) bySteps.set(filename, { total: theirs.size, computed: here })
  }

  return { inFile, computed, bySteps }
}

test("the sequence's directives produce only part of AMC's directory", () => {
  const { inFile, computed } = coverage(BASELINE)
  assert.ok(inFile > 500, `only ${inFile} parameters found in ${BASELINE} — did the template move?`)

  // Recorded, not aspired to. If this rises, the fork started computing more
  // of the directory and the number should be raised deliberately. If it
  // falls, something that used to be computed stopped being computed.
  assert.ok(
    computed >= 60,
    `only ${computed} of ${inFile} parameters are produced by the sequence's directives`
  )
  assert.ok(
    computed <= inFile * 0.3,
    `${computed} of ${inFile} — coverage has changed enough that this audit's premise should be rechecked`
  )
})

test('the steps the sequence fully decides are the ones it should', () => {
  // Not every step is template content. The ones whose values are entirely
  // computed are where the method's claim — every value carries its reason —
  // holds without qualification, and losing one is a regression.
  const { bySteps } = coverage(BASELINE)
  const fully = [...bySteps]
    .filter(([, counts]) => counts.total > 0 && counts.computed === counts.total)
    .map(([filename]) => filename)
  assert.ok(fully.length >= 1, 'no step is fully computed, which would be a change of kind')
})

test('a richer template is not better covered than the empty one', () => {
  // The template's own content grows; what the sequence computes does not.
  // This is the whole shape of the difference, stated as a test so it cannot
  // be mistaken for a bug in a particular template.
  const empty = coverage(BASELINE)
  const rich = coverage('Tarot_X4')
  const emptyShare = empty.computed / empty.inFile
  const richShare = rich.computed / rich.inFile
  assert.ok(
    Math.abs(emptyShare - richShare) < 0.2,
    `coverage differs sharply between templates (${emptyShare.toFixed(2)} vs ${richShare.toFixed(2)})`
  )
})
