/**
 * The temperature calibration, drawn.
 *
 * AMC writes `tempcal_gyro.png` and `tempcal_acc.png` beside the results, and
 * the reason is not decoration: a cubic fitted through a narrow or noisy
 * sweep produces confident-looking coefficients, and the only cheap way to
 * tell a good calibration from a bad one is to look at it. A curve that
 * follows its samples is trustworthy; one that swings away from them at the
 * ends is a polynomial doing what polynomials do.
 *
 * Drawn as SVG rather than a raster: it is a few kilobytes, it stays sharp,
 * and it needs no canvas — which matters because this runs in a worker-free
 * browser path and lands in a directory an operator may open anywhere.
 */

import { POLYNOMIAL_ORDER, TEMPERATURE_REFERENCE } from './tempcal.js'
import type { ImuSamples } from './tempcal.js'

export interface PlotOptions {
  /** The axis being drawn, for the title. */
  readonly label: string
  readonly width?: number
  readonly height?: number
}

/**
 * One axis: its samples, and the curve fitted through them.
 *
 * `coefficients` are highest-order first, in the units the samples are in —
 * not the scaled form written to the parameters.
 */
export function plotTemperatureFit(
  samples: ImuSamples,
  axis: 'x' | 'y' | 'z',
  coefficients: readonly number[],
  options: PlotOptions
): string {
  const { label, width = 640, height = 220 } = options
  const pad = { left: 56, right: 12, top: 22, bottom: 30 }
  const values = samples[axis]
  const temps = samples.temperature
  if (temps.length === 0 || values.length === 0) return ''

  const tMin = Math.min(...temps)
  const tMax = Math.max(...temps)
  // The curve can leave the samples' range, and hiding that would defeat the
  // point of drawing it.
  const curve: [number, number][] = []
  for (let i = 0; i <= 80; i += 1) {
    const t = tMin + ((tMax - tMin) * i) / 80
    curve.push([t, evaluate(coefficients, t - TEMPERATURE_REFERENCE)])
  }
  const vMin = Math.min(...values, ...curve.map(([, v]) => v))
  const vMax = Math.max(...values, ...curve.map(([, v]) => v))
  const span = vMax - vMin || 1

  const x = (t: number) => pad.left + ((t - tMin) / (tMax - tMin || 1)) * (width - pad.left - pad.right)
  const y = (v: number) => height - pad.bottom - ((v - vMin) / span) * (height - pad.top - pad.bottom)

  const dots = values
    .map((value, i) => `<circle cx="${x(temps[i] as number).toFixed(1)}" cy="${y(value).toFixed(1)}" r="1.4"/>`)
    .join('')
  const path = curve
    .map(([t, v], i) => `${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ')

  // `currentColor` throughout, so the plot follows whatever it is dropped
  // into rather than assuming a light page.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(label)}">`,
    `<title>${escapeXml(label)}</title>`,
    `<g fill="none" stroke="currentColor" stroke-opacity="0.25">`,
    `<path d="M${pad.left} ${pad.top} L${pad.left} ${height - pad.bottom} L${width - pad.right} ${height - pad.bottom}"/>`,
    `</g>`,
    `<g fill="currentColor" font-size="10" fill-opacity="0.7">`,
    `<text x="${pad.left}" y="12">${escapeXml(label)}</text>`,
    `<text x="${pad.left}" y="${height - 8}">${tMin.toFixed(0)} °C</text>`,
    `<text x="${width - pad.right}" y="${height - 8}" text-anchor="end">${tMax.toFixed(0)} °C</text>`,
    `<text x="4" y="${pad.top + 4}">${vMax.toPrecision(3)}</text>`,
    `<text x="4" y="${height - pad.bottom}">${vMin.toPrecision(3)}</text>`,
    `</g>`,
    `<g fill="currentColor" fill-opacity="0.45">${dots}</g>`,
    `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    `</svg>`
  ].join('')
}

/** Horner, so the curve is evaluated the way ArduPilot evaluates it. */
function evaluate(coefficients: readonly number[], t: number): number {
  let out = 0
  for (const coefficient of coefficients) out = out * t + coefficient
  return out
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (char) =>
    char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : '&quot;'
  )
}

void POLYNOMIAL_ORDER
