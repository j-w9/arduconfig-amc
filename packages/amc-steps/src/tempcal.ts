/**
 * IMU temperature calibration, fitted from a flight log.
 *
 * A gyro's zero drifts with temperature, and an accelerometer's with it. The
 * sequence has three steps for this — set it up, fly a cool-to-warm profile,
 * write the results — and the middle one produces nothing this app could use
 * until now. AMC fits a cubic through the drift and writes the coefficients
 * ArduPilot applies at runtime.
 *
 * This is a port of AMC's `tempcal_imu.py` restricted to what a `.bin` log can
 * answer: the polynomial fit and the parameters it produces. The plots AMC
 * draws alongside are not reproduced.
 *
 * The result is only as good as the flight it came from. A log whose IMUs
 * barely changed temperature fits a curve through noise, so the span is
 * reported and a caller can refuse it — a confident calibration from a
 * five-degree range is worse than none.
 */

/** ArduPilot fits the drift relative to 35 °C. */
export const TEMPERATURE_REFERENCE = 35

/** A cubic, as ArduPilot's own runtime correction expects. */
export const POLYNOMIAL_ORDER = 3

/** The parameters are stored scaled, so the small coefficients stay readable. */
const SCALE_FACTOR = 1e6

/** One IMU's samples: temperature against each axis. */
export interface ImuSamples {
  readonly temperature: readonly number[]
  readonly x: readonly number[]
  readonly y: readonly number[]
  readonly z: readonly number[]
}

export interface ImuCalibrationInput {
  /** Zero-based IMU index, as the log numbers them. */
  readonly imu: number
  readonly accel: ImuSamples
  readonly gyro: ImuSamples
}

export interface ImuCalibration {
  readonly imu: number
  readonly temperatureMin: number
  readonly temperatureMax: number
  /** How far the IMU's temperature actually moved, which is what makes a fit real. */
  readonly temperatureSpan: number
  readonly samples: number
  /** `INS_TCAL1_GYR1_X` and friends, already scaled. */
  readonly parameters: Readonly<Record<string, number>>
}

export interface TempcalResult {
  readonly calibrations: readonly ImuCalibration[]
  /** IMUs that were in the log but could not be fitted, and why. */
  readonly rejected: readonly { readonly imu: number; readonly reason: string }[]
}

export interface TempcalOptions {
  /**
   * The temperature range a log must cover to be worth fitting.
   *
   * AMC's own guidance is to cool the controller and let it warm up; a log
   * that never did produces a curve fitted to noise, which ArduPilot would
   * then apply at every temperature. Refusing is the kinder answer.
   */
  readonly minimumSpan?: number
}

export function fitTemperatureCalibration(
  imus: readonly ImuCalibrationInput[],
  options: TempcalOptions = {}
): TempcalResult {
  const { minimumSpan = 10 } = options
  const calibrations: ImuCalibration[] = []
  const rejected: { imu: number; reason: string }[] = []

  for (const input of imus) {
    const temps = input.accel.temperature
    if (temps.length <= POLYNOMIAL_ORDER) {
      rejected.push({
        imu: input.imu,
        reason: `only ${temps.length} samples, which cannot determine a cubic`
      })
      continue
    }

    const min = Math.min(...temps)
    const max = Math.max(...temps)
    const span = max - min
    if (span < minimumSpan) {
      rejected.push({
        imu: input.imu,
        reason: `its temperature only moved ${span.toFixed(1)} °C, too little to fit a curve through`
      })
      continue
    }

    const parameters: Record<string, number> = {}
    const n = input.imu + 1
    parameters[`INS_TCAL${n}_ENABLE`] = 1
    parameters[`INS_TCAL${n}_TMIN`] = round(min, 1)
    parameters[`INS_TCAL${n}_TMAX`] = round(max, 1)

    // The accelerometer is fitted about its own mean: the calibration
    // describes how the reading DRIFTS, not what it reads, and the standing
    // offset belongs to the accelerometer calibration instead.
    addAxes(parameters, `INS_TCAL${n}_ACC`, input.accel, true)
    // A gyro at rest should read zero, so its drift is the reading itself.
    addAxes(parameters, `INS_TCAL${n}_GYR`, input.gyro, false)

    calibrations.push({
      imu: input.imu,
      temperatureMin: min,
      temperatureMax: max,
      temperatureSpan: span,
      samples: temps.length,
      parameters
    })
  }

  return { calibrations, rejected }
}

function addAxes(
  parameters: Record<string, number>,
  prefix: string,
  samples: ImuSamples,
  subtractMean: boolean
): void {
  const relative = samples.temperature.map((t) => t - TEMPERATURE_REFERENCE)
  for (const [axis, values] of [
    ['X', samples.x],
    ['Y', samples.y],
    ['Z', samples.z]
  ] as const) {
    const offset = subtractMean ? mean(values) : 0
    // Highest order first, as np.polyfit returns them.
    const coefficients = polyfit(relative, values.map((v) => v - offset), POLYNOMIAL_ORDER)
    for (let order = 1; order <= POLYNOMIAL_ORDER; order += 1) {
      // ArduPilot names them 1..3 from the LOWEST order, which is the reverse
      // of the fit's own ordering.
      parameters[`${prefix}${order}_${axis}`] =
        (coefficients[POLYNOMIAL_ORDER - order] ?? 0) * SCALE_FACTOR
    }
  }
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Least-squares polynomial fit, highest order first.
 *
 * Solved through the normal equations with Gaussian elimination. For a cubic
 * over a few thousand samples that is both accurate enough and short enough to
 * read, which matters more here than the numerical care a general-purpose
 * routine would need: the alternative was a linear-algebra dependency in the
 * path that writes coefficients to a flight controller.
 */
export function polyfit(x: readonly number[], y: readonly number[], order: number): number[] {
  const terms = order + 1
  // Sums of powers of x up to 2*order, which is all the normal equations need.
  const powerSums = new Array<number>(2 * order + 1).fill(0)
  const moments = new Array<number>(terms).fill(0)
  for (let i = 0; i < x.length; i += 1) {
    let power = 1
    for (let p = 0; p <= 2 * order; p += 1) {
      powerSums[p] = (powerSums[p] as number) + power
      if (p < terms) moments[p] = (moments[p] as number) + power * (y[i] as number)
      power *= x[i] as number
    }
  }

  // The Vandermonde normal matrix, ordered lowest power first.
  const matrix: number[][] = []
  for (let row = 0; row < terms; row += 1) {
    const line = new Array<number>(terms + 1)
    for (let col = 0; col < terms; col += 1) line[col] = powerSums[row + col] as number
    line[terms] = moments[row] as number
    matrix.push(line)
  }

  const solution = solve(matrix)
  // Highest order first, to match np.polyfit.
  return solution.reverse()
}

/** Gaussian elimination with partial pivoting on an augmented matrix. */
function solve(matrix: number[][]): number[] {
  const n = matrix.length
  for (let col = 0; col < n; col += 1) {
    // Pivot on the largest magnitude, without which a leading zero divides.
    let best = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs((matrix[row] as number[])[col] as number) > Math.abs((matrix[best] as number[])[col] as number)) {
        best = row
      }
    }
    const temp = matrix[col] as number[]
    matrix[col] = matrix[best] as number[]
    matrix[best] = temp

    const pivot = (matrix[col] as number[])[col] as number
    // A singular system means the samples do not determine the polynomial —
    // every temperature identical, say. Zeroes are the honest answer, and the
    // span check above is what stops that reaching a flight controller.
    if (Math.abs(pivot) < 1e-12) return new Array<number>(n).fill(0)

    for (let row = col + 1; row < n; row += 1) {
      const factor = ((matrix[row] as number[])[col] as number) / pivot
      if (factor === 0) continue
      for (let k = col; k <= n; k += 1) {
        ;(matrix[row] as number[])[k] =
          ((matrix[row] as number[])[k] as number) - factor * ((matrix[col] as number[])[k] as number)
      }
    }
  }

  const out = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = (matrix[row] as number[])[n] as number
    for (let col = row + 1; col < n; col += 1) {
      sum -= ((matrix[row] as number[])[col] as number) * (out[col] as number)
    }
    out[row] = sum / ((matrix[row] as number[])[row] as number)
  }
  return out
}

/** A message as the DataFlash parser hands it over. */
type LogMessage = { readonly name: string } & Record<string, number | string | number[]>

/**
 * Pull each IMU's temperature samples out of a parsed log.
 *
 * ArduPilot writes one `IMU` message per sensor per sample, with an `I`
 * column naming the instance on newer firmware and the message itself
 * numbered (`IMU`, `IMU2`, `IMU3`) on older. Both are read, because a log
 * from either is a log an operator may have.
 */
export function imuSamplesFromLog(
  messagesByType: ReadonlyMap<string, readonly LogMessage[]>
): ImuCalibrationInput[] {
  const byImu = new Map<number, { accel: Mutable; gyro: Mutable }>()

  for (const [name, messages] of messagesByType) {
    const match = /^IMU(\d*)$/.exec(name)
    if (!match) continue
    // `IMU` is instance 0, `IMU2` is instance 1 — the message suffix counts
    // from one while the instance column counts from zero.
    const fromName = match[1] ? Number(match[1]) - 1 : 0

    for (const message of messages) {
      const temperature = numberOf(message.T)
      // No temperature, nothing to calibrate against. A log written without
      // the IMU's temperature is the common reason this finds nothing.
      if (temperature === undefined) continue
      const instance = numberOf(message.I) ?? fromName
      const entry = byImu.get(instance) ?? { accel: blank(), gyro: blank() }
      byImu.set(instance, entry)

      push(entry.accel, temperature, message.AccX, message.AccY, message.AccZ)
      push(entry.gyro, temperature, message.GyrX, message.GyrY, message.GyrZ)
    }
  }

  return [...byImu.entries()]
    .sort(([a], [b]) => a - b)
    .map(([imu, entry]) => ({ imu, accel: entry.accel, gyro: entry.gyro }))
}

interface Mutable {
  temperature: number[]
  x: number[]
  y: number[]
  z: number[]
}

const blank = (): Mutable => ({ temperature: [], x: [], y: [], z: [] })

function push(
  into: Mutable,
  temperature: number,
  x: unknown,
  y: unknown,
  z: unknown
): void {
  const ax = numberOf(x)
  const ay = numberOf(y)
  const az = numberOf(z)
  // All three axes or none: a partial sample would pair one axis's reading
  // with another's temperature once the arrays fell out of step.
  if (ax === undefined || ay === undefined || az === undefined) return
  into.temperature.push(temperature)
  into.x.push(ax)
  into.y.push(ay)
  into.z.push(az)
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
