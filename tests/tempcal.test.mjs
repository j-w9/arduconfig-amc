// IMU temperature calibration, fitted from a flight log.
//
// A gyro's zero drifts with temperature. ArduPilot corrects it from a cubic,
// and these coefficients go to a flight controller — so the fit is graded
// against numpy, the library AMC itself uses, rather than against a
// reimplementation that could share this one's misunderstandings.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  POLYNOMIAL_ORDER,
  TEMPERATURE_REFERENCE,
  fitTemperatureCalibration,
  polyfit
} from '../packages/amc-steps/dist/index.js'

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/polyfit.json', import.meta.url)), 'utf8')
)

test('the fit agrees with numpy on every golden case', () => {
  assert.ok(golden.length >= 5, 'the golden corpus did not load')
  for (const item of golden) {
    const ours = polyfit(item.x, item.y, POLYNOMIAL_ORDER)
    assert.equal(ours.length, item.coefficients.length, item.name)
    for (let i = 0; i < ours.length; i += 1) {
      const expected = item.coefficients[i]
      // Relative where the coefficient is meaningful, absolute where numpy's
      // own answer is a rounding artefact around zero.
      const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-6)
      assert.ok(
        Math.abs(ours[i] - expected) <= tolerance,
        `${item.name} coefficient ${i}: ours ${ours[i]}, numpy ${expected}`
      )
    }
  }
})

/** A synthetic IMU whose drift is a known cubic in (T - 35). */
function samples(count, f, from = 5, to = 65) {
  const temperature = []
  const x = []
  const y = []
  const z = []
  for (let i = 0; i < count; i += 1) {
    const t = from + ((to - from) * i) / (count - 1)
    temperature.push(t)
    x.push(f(t - TEMPERATURE_REFERENCE))
    y.push(f(t - TEMPERATURE_REFERENCE) * 2)
    z.push(f(t - TEMPERATURE_REFERENCE) * -1)
  }
  return { temperature, x, y, z }
}

const drift = (t) => 0.002 + 0.0001 * t + 1e-6 * t * t + 1e-8 * t * t * t

test('a fitted IMU produces the parameters ArduPilot applies', () => {
  const { calibrations, rejected } = fitTemperatureCalibration([
    { imu: 0, accel: samples(60, drift), gyro: samples(60, drift) }
  ])
  assert.deepEqual(rejected, [])
  assert.equal(calibrations.length, 1)

  const p = calibrations[0].parameters
  assert.equal(p.INS_TCAL1_ENABLE, 1)
  assert.equal(p.INS_TCAL1_TMIN, 5)
  assert.equal(p.INS_TCAL1_TMAX, 65)
  // Three orders, three axes, for each of accel and gyro — plus the three above.
  assert.equal(Object.keys(p).length, 3 + POLYNOMIAL_ORDER * 3 * 2)
  for (const name of ['INS_TCAL1_GYR1_X', 'INS_TCAL1_GYR3_Z', 'INS_TCAL1_ACC1_X', 'INS_TCAL1_ACC3_Z']) {
    assert.ok(name in p, `${name} missing`)
  }
})

test('the gyro coefficients recover the drift that was put in', () => {
  // The whole point: ArduPilot evaluates this polynomial at runtime, so the
  // numbers have to mean what the drift meant.
  const { calibrations } = fitTemperatureCalibration([
    { imu: 0, accel: samples(80, drift), gyro: samples(80, drift) }
  ])
  const p = calibrations[0].parameters
  // Stored scaled by 1e6, lowest order first as ArduPilot numbers them.
  assert.ok(Math.abs(p.INS_TCAL1_GYR1_X / 1e6 - 0.0001) < 1e-9, `got ${p.INS_TCAL1_GYR1_X / 1e6}`)
  assert.ok(Math.abs(p.INS_TCAL1_GYR2_X / 1e6 - 1e-6) < 1e-11)
  assert.ok(Math.abs(p.INS_TCAL1_GYR3_X / 1e6 - 1e-8) < 1e-13)
})

test('the accelerometer is fitted about its own mean', () => {
  // The calibration describes how a reading DRIFTS, not what it reads: the
  // standing offset belongs to the accelerometer calibration instead. A
  // constant 9.81 must therefore fit to nothing at all.
  const flat = samples(40, () => 9.81)
  const { calibrations } = fitTemperatureCalibration([
    { imu: 0, accel: flat, gyro: samples(40, drift) }
  ])
  const p = calibrations[0].parameters
  for (const order of [1, 2, 3]) {
    assert.ok(
      Math.abs(p[`INS_TCAL1_ACC${order}_X`]) < 1e-3,
      `a constant accelerometer produced a drift term: ${p[`INS_TCAL1_ACC${order}_X`]}`
    )
  }
})

test('a log whose IMU barely warmed up is refused, not fitted', () => {
  // A confident calibration from a five-degree range is worse than none: the
  // curve is fitted to noise and ArduPilot would apply it at every
  // temperature.
  const { calibrations, rejected } = fitTemperatureCalibration([
    { imu: 0, accel: samples(50, drift, 30, 34), gyro: samples(50, drift, 30, 34) }
  ])
  assert.deepEqual(calibrations, [])
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].reason, /only moved 4\.0 °C/)
})

test('too few samples to determine a cubic is refused', () => {
  const short = { temperature: [10, 30, 50], x: [1, 2, 3], y: [1, 2, 3], z: [1, 2, 3] }
  const { calibrations, rejected } = fitTemperatureCalibration([{ imu: 0, accel: short, gyro: short }])
  assert.deepEqual(calibrations, [])
  assert.match(rejected[0].reason, /cannot determine a cubic/)
})

test('each IMU is calibrated separately and numbered from one', () => {
  // INS_TCAL1 is the log's IMU 0. Getting this wrong applies one sensor's
  // drift correction to another.
  const { calibrations } = fitTemperatureCalibration([
    { imu: 0, accel: samples(40, drift), gyro: samples(40, drift) },
    { imu: 2, accel: samples(40, drift), gyro: samples(40, drift) }
  ])
  assert.deepEqual(calibrations.map((c) => c.imu), [0, 2])
  assert.ok('INS_TCAL1_ENABLE' in calibrations[0].parameters)
  assert.ok('INS_TCAL3_ENABLE' in calibrations[1].parameters)
})

test('one bad IMU does not lose the good ones', () => {
  const { calibrations, rejected } = fitTemperatureCalibration([
    { imu: 0, accel: samples(40, drift), gyro: samples(40, drift) },
    { imu: 1, accel: samples(40, drift, 30, 33), gyro: samples(40, drift, 30, 33) }
  ])
  assert.deepEqual(calibrations.map((c) => c.imu), [0])
  assert.deepEqual(rejected.map((r) => r.imu), [1])
})

test('samples that determine nothing produce zeroes rather than infinities', () => {
  // Every temperature identical makes the system singular. NaN coefficients
  // written to a flight controller would be considerably worse than zeroes,
  // and the span check is what stops this reaching one anyway.
  const coefficients = polyfit([5, 5, 5, 5, 5], [1, 2, 3, 4, 5], 3)
  assert.equal(coefficients.length, 4)
  for (const value of coefficients) assert.ok(Number.isFinite(value), `${value} is not finite`)
})

// ── Reading the samples out of a log ─────────────────────────────────────

import { imuSamplesFromLog } from '../packages/amc-steps/dist/index.js'

const imuMessage = (extra) => ({ name: 'IMU', GyrX: 0.001, GyrY: 0.002, GyrZ: 0.003, AccX: 0.1, AccY: 0.2, AccZ: 9.8, ...extra })

test('an instance column names the IMU', () => {
  const messages = new Map([
    ['IMU', [imuMessage({ I: 0, T: 20 }), imuMessage({ I: 1, T: 21 }), imuMessage({ I: 0, T: 22 })]]
  ])
  const imus = imuSamplesFromLog(messages)
  assert.deepEqual(imus.map((i) => i.imu), [0, 1])
  assert.deepEqual(imus[0].accel.temperature, [20, 22])
  assert.deepEqual(imus[1].accel.temperature, [21])
})

test('an older log numbers the MESSAGE instead, counting from one', () => {
  // `IMU` is instance 0 and `IMU2` is instance 1: the suffix counts from one
  // while the instance column counts from zero. Getting this wrong applies
  // one sensor's drift correction to another.
  const messages = new Map([
    ['IMU', [imuMessage({ T: 20 })]],
    ['IMU2', [imuMessage({ T: 21 })]],
    ['IMU3', [imuMessage({ T: 22 })]]
  ])
  assert.deepEqual(imuSamplesFromLog(messages).map((i) => i.imu), [0, 1, 2])
})

test('a log with no IMU temperature yields nothing to calibrate', () => {
  // The common reason this finds nothing: the temperature was never logged.
  const messages = new Map([['IMU', [imuMessage({ I: 0 })]]])
  assert.deepEqual(imuSamplesFromLog(messages), [])
})

test('a partial sample is dropped rather than skewing an axis', () => {
  // Pushing two axes and not the third would pair one axis's reading with
  // another's temperature from then on.
  const messages = new Map([
    ['IMU', [imuMessage({ I: 0, T: 20 }), { name: 'IMU', I: 0, T: 21, GyrX: 1, GyrY: 2 }]]
  ])
  const [imu] = imuSamplesFromLog(messages)
  assert.deepEqual(imu.gyro.temperature, [20])
  assert.equal(imu.gyro.x.length, imu.gyro.temperature.length)
})

test('messages that are not IMU ones are ignored', () => {
  const messages = new Map([
    ['IMUDT', [{ name: 'IMUDT', I: 0, T: 20, GyrX: 1, GyrY: 1, GyrZ: 1, AccX: 1, AccY: 1, AccZ: 1 }]],
    ['GPS', [{ name: 'GPS', T: 20 }]]
  ])
  assert.deepEqual(imuSamplesFromLog(messages), [])
})

test('a log read end to end produces a calibration', () => {
  // The two halves together, which is how the tab uses them.
  const messages = []
  for (let i = 0; i < 80; i += 1) {
    const t = 5 + (60 * i) / 79
    const rel = t - TEMPERATURE_REFERENCE
    messages.push(imuMessage({ I: 0, T: t, GyrX: 0.002 + 0.0001 * rel, GyrY: 0, GyrZ: 0 }))
  }
  const { calibrations, rejected } = fitTemperatureCalibration(
    imuSamplesFromLog(new Map([['IMU', messages]]))
  )
  assert.deepEqual(rejected, [])
  assert.equal(calibrations.length, 1)
  assert.ok(Math.abs(calibrations[0].parameters.INS_TCAL1_GYR1_X / 1e6 - 0.0001) < 1e-9)
})
