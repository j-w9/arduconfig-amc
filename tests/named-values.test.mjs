// Resolving a component's own words to the number a parameter takes.
//
// Several steps set a parameter from what the operator declared -- FRAME_CLASS
// from 'Quad', BATT_MONITOR from a protocol name -- which needs ArduPilot's
// documented value lists. Two things made that fail on real templates, and
// neither was a missing value.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { UnresolvableValueError, parameterDocsFrom, resolveNamedValue } from '../packages/amc-steps/dist/index.js'

const metaDir = fileURLToPath(new URL('../apps/arduconfigurator/apps/web/src/generated/param-upstream/', import.meta.url))
const copter = parameterDocsFrom(JSON.parse(readFileSync(`${metaDir}arducopter.json`, 'utf8')))
const plane = parameterDocsFrom(JSON.parse(readFileSync(`${metaDir}arduplane.json`, 'utf8')))

test('a label carrying a parenthetical part list still matches its bare name', () => {
  // ArduPilot documents this one as "INA2XX (INA226 INA228 INA238 INA231
  // INA260)"; a vehicle declares it as "INA2XX".
  const value = resolveNamedValue('BATT_MONITOR', 'INA2XX', copter)
  assert.equal(typeof value, 'number')
  // The bare name has to be exactly right: the parenthesis is the only slack.
  assert.throws(() => resolveNamedValue('BATT_MONITOR', 'INA2', copter), UnresolvableValueError)
  assert.throws(() => resolveNamedValue('BATT_MONITOR', 'INA2XX (INA226)', copter), UnresolvableValueError)
})

test('an exact label still resolves', () => {
  assert.equal(resolveNamedValue('FRAME_CLASS', 'Quad', copter), 1)
  assert.equal(resolveNamedValue('MOT_PWM_TYPE', 'DShot600', copter), 6)
})

test("a quadplane's motor PWM type answers for MOT_PWM_TYPE", () => {
  // Plane has no MOT_PWM_TYPE at all; the quadplane parameter is Q_M_PWM_TYPE,
  // and AMC resolves it the same way.
  assert.equal(plane('MOT_PWM_TYPE'), undefined)
  assert.equal(resolveNamedValue('MOT_PWM_TYPE', 'DShot600', plane), resolveNamedValue('Q_M_PWM_TYPE', 'DShot600', plane))
})

test('a named value with no number behind it is still refused', () => {
  // FETtecOneWire is a serial ESC protocol, so MOT_PWM_TYPE -- which lists PWM
  // output types -- genuinely has no value for it. Aliasing must not paper
  // over that.
  assert.throws(
    () => resolveNamedValue('MOT_PWM_TYPE', 'FETtecOneWire', copter),
    (error) => error instanceof UnresolvableValueError && error.reason === 'unknown-label'
  )
})

test('a bitmask value is the bit, not the bit index', () => {
  // RC_PROTOCOLS documents PPM as bit 1, and setting it means writing 2.
  assert.equal(resolveNamedValue('RC_PROTOCOLS', 'PPM', copter), 2)
})
