// Where the sequence and ArduPilot's published ranges disagree.
//
// Staging the sequence produced an unexplained "N invalid" from the app's draft
// validation. This is the catalogue of why, over every vendored template, so the
// answer is a fact rather than a guess -- and so the set cannot grow quietly.
//
// Every entry here is a value the firmware accepts and the *documentation*
// does not describe. Three kinds:
//
//   1. A 0 that means "disabled" on a parameter whose @Range starts higher.
//      MOT_BAT_VOLT_MAX's own description says "0 = Disabled" and its range
//      says minimum 6. This is most of them.
//   2. A bit the metadata has not caught up with. AUTOTUNE_AXES documents
//      Roll/Pitch/Yaw (ceiling 7); the sequence's own step is named for YawD,
//      which is bit 3, so it sets 8.
//   3. A range too tight for real hardware: a 22S pack is 92.4 V against a
//      documented maximum of 53, and a small propeller puts the rate filter at
//      57.5 Hz against a documented 50.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { applyStep, orderSteps, parameterDocsFrom, parseStepFile, vehicleContext } from '../packages/amc-steps/dist/index.js'

const R = new URL('..', import.meta.url)
const templates = fileURLToPath(
  new URL('vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', R)
)
const stepsDir = fileURLToPath(new URL('steps/', R))
const metaDir = fileURLToPath(new URL('apps/arduconfigurator/apps/web/src/generated/param-upstream/', R))
const DOCS = { ArduCopter: 'arducopter', ArduPlane: 'arduplane', Rover: 'ardurover', Heli: 'arducopter' }

function readParams(path) {
  const params = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim()
    if (!line) continue
    const match = /^(\S+)[,\s]+(\S+)$/.exec(line)
    if (!match) continue
    const value = Number(match[2])
    if (!Number.isNaN(value)) params[match[1]] = value
  }
  return params
}

/** The bitmask ceiling, the way the app derives it: every documented bit set. */
function bitmaskMaximum(definition) {
  if (definition?.bitmask !== true || !definition.options?.length) return undefined
  let mask = 0
  for (const option of definition.options) {
    if (!Number.isInteger(option.value) || option.value < 0 || option.value > 30) return undefined
    mask |= 1 << option.value
  }
  return mask >>> 0
}

/** The same three rules the draft validation applies. */
function judge(definition, value) {
  if (!definition) return undefined
  if (definition.minimum !== undefined && value < definition.minimum) return 'below-minimum'
  const maximum = definition.maximum ?? bitmaskMaximum(definition)
  if (maximum !== undefined && value > maximum) return 'above-maximum'
  if (definition.options?.length && !definition.bitmask && !definition.options.some((o) => Object.is(o.value, value))) {
    return 'enum-mismatch'
  }
  return undefined
}

function survey() {
  const found = new Map()
  let proposals = 0
  for (const [vehicle, docFile] of Object.entries(DOCS)) {
    if (!existsSync(templates + vehicle)) continue
    const metadata = JSON.parse(readFileSync(`${metaDir}${docFile}.json`, 'utf8'))
    const docs = parameterDocsFrom(metadata)
    const steps = orderSteps(parseStepFile(readFileSync(`${stepsDir}configuration_steps_${vehicle}.json`, 'utf8')))
    for (const name of readdirSync(templates + vehicle)) {
      const dir = `${templates}${vehicle}/${name}`
      if (!existsSync(`${dir}/vehicle_components.json`) || !existsSync(`${dir}/00_default.param`)) continue
      const context = vehicleContext(readFileSync(`${dir}/vehicle_components.json`, 'utf8'), readParams(`${dir}/00_default.param`))
      for (const { step } of steps) {
        for (const change of applyStep(step, context, { docs }).changes) {
          proposals += 1
          const verdict = judge(metadata[change.parameter], change.value)
          if (!verdict) continue
          const key = `${change.parameter}:${verdict}`
          if (!found.has(key)) found.set(key, new Set())
          found.get(key).add(change.value)
        }
      }
    }
  }
  return { found, proposals }
}

// Every disagreement, as parameter:kind. Pinned: a new one is either a genuine
// upstream change worth reading, or a regression in what we compute.
const KNOWN = new Set([
  // 1. Zero means "disabled" and the range does not say so.
  'MOT_BAT_VOLT_MAX:below-minimum',
  'MOT_BAT_VOLT_MIN:below-minimum',
  'ATC_RAT_RLL_FLTE:below-minimum',
  'ATC_RAT_PIT_FLTE:below-minimum',
  'ATC_RAT_YAW_FLTE:below-minimum',
  'ATC_RAT_RLL_NEF:below-minimum',
  'ATC_RAT_RLL_NTF:below-minimum',
  'ATC_RAT_PIT_NEF:below-minimum',
  'ATC_RAT_PIT_NTF:below-minimum',
  'ATC_RAT_YAW_NEF:below-minimum',
  'ATC_RAT_YAW_NTF:below-minimum',
  'INS_HNTCH_FREQ:below-minimum',
  'ATC_ANG_YAW_P:below-minimum',
  // Notch filter indices, 0 = no notch assigned.
  'PSC_D_ACC_NEF:below-minimum',
  'PSC_D_ACC_NTF:below-minimum',
  // 2. A bit the metadata has not caught up with (AUTOTUNE_AXES YawD = bit 3).
  'AUTOTUNE_AXES:above-maximum',
  // 3. A documented range too tight for real hardware.
  'MOT_BAT_VOLT_MAX:above-maximum',
  'MOT_BAT_VOLT_MIN:above-maximum',
  'ATC_RAT_RLL_FLTD:above-maximum',
  'ATC_RAT_RLL_FLTT:above-maximum',
  'ATC_RAT_PIT_FLTD:above-maximum',
  'ATC_RAT_PIT_FLTT:above-maximum',
  'ATC_RAT_YAW_FLTD:above-maximum',
  'ATC_RAT_YAW_FLTT:above-maximum',
  'INS_GYRO_FILTER:above-maximum',
  'MOT_THST_EXPO:above-maximum',
  'MOT_THST_EXPO:below-minimum',
  'ATC_ANG_PIT_P:below-minimum',
  'ATC_ANG_RLL_P:below-minimum',
  // A small, light quad accelerates harder than the documented 1800 deg/s/s.
  'ATC_ACC_P_MAX:above-maximum',
  'ATC_ACC_R_MAX:above-maximum'
])

test('the sequence and the documented ranges disagree only where we know', () => {
  const { found, proposals } = survey()
  assert.ok(proposals > 2000, `only ${proposals} proposals surveyed`)
  const unexpected = [...found.keys()].filter((key) => !KNOWN.has(key))
  assert.deepEqual(
    unexpected,
    [],
    `new disagreements between the sequence and ArduPilot's documented ranges:\n  ${unexpected.join('\n  ')}`
  )
})

test('not one of them is an enum mismatch', () => {
  // The named values are resolved through the documentation itself, so a value
  // outside the enum would mean the resolution is wrong rather than the range
  // being narrow. None occur, and that is the check.
  const { found } = survey()
  const mismatches = [...found.keys()].filter((key) => key.endsWith(':enum-mismatch'))
  assert.deepEqual(mismatches, [])
})

test('the disputes are a small share of what the sequence proposes', () => {
  const { found, proposals } = survey()
  // If this ever climbed, the port would be the first suspect, not the metadata.
  assert.ok(found.size < 40, `${found.size} distinct disputes is more than expected`)
  assert.ok(found.size > 0, 'expected the known documented-range disputes')
  assert.ok(proposals > found.size * 50, 'disputes should be rare among proposals')
})
