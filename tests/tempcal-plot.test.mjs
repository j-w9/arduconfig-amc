// The temperature calibration, drawn.
//
// A cubic through a narrow or noisy sweep produces confident-looking
// coefficients, and the cheap way to tell a good calibration from a bad one
// is to look at it. These tests are about the plot being HONEST — showing the
// samples and the curve on the same scale — rather than about how it looks.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TEMPERATURE_REFERENCE, plotTemperatureFit } from '../packages/amc-steps/dist/index.js'

const samples = (from, to, f, count = 40) => {
  const temperature = []
  const x = []
  for (let i = 0; i < count; i += 1) {
    const t = from + ((to - from) * i) / (count - 1)
    temperature.push(t)
    x.push(f(t - TEMPERATURE_REFERENCE))
  }
  return { temperature, x, y: x, z: x }
}

const line = (t) => 0.002 + 0.0001 * t

test('it draws every sample and the curve through them', () => {
  const svg = plotTemperatureFit(samples(5, 65, line), 'x', [0, 0, 0.0001, 0.002], { label: 'Gyro X' })
  assert.match(svg, /^<svg /)
  // One mark per sample: a plot that silently dropped points would hide the
  // scatter that says whether the fit is trustworthy.
  assert.equal((svg.match(/<circle /g) ?? []).length, 40)
  assert.match(svg, /<path d="M/)
  assert.match(svg, /Gyro X/)
})

test('the curve is drawn on the same scale as the samples', () => {
  // The failure this guards: a curve that swings away from its samples at the
  // ends is a polynomial misbehaving, and a plot that rescaled to hide that
  // would be worse than no plot.
  const wild = plotTemperatureFit(samples(5, 65, line), 'x', [1e-5, 0, 0, 0], { label: 'Gyro X' })
  const bounds = [...wild.matchAll(/<text x="4"[^>]*>([-\d.e+]+)<\/text>/g)].map((m) => Number(m[1]))
  assert.equal(bounds.length, 2)
  const [high, low] = bounds
  // A cubic with a 1e-5 leading term reaches far beyond the samples' own
  // range, and the axis has to say so.
  assert.ok(high - low > 0.1, `the axis collapsed to ${low}..${high}`)
})

test('it is valid, self-contained SVG', () => {
  const svg = plotTemperatureFit(samples(5, 65, line), 'x', [0, 0, 0.0001, 0.002], { label: 'Gyro X' })
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /<\/svg>$/)
  // No external anything: the file lands in a directory that may be opened
  // anywhere, including with no network.
  assert.ok(!/<image|href=|url\(/.test(svg), 'the plot pulls in something external')
  // Colour follows whatever it is dropped into rather than assuming a page.
  assert.ok(!/#[0-9a-f]{3,6}/i.test(svg), 'the plot hardcodes a colour')
})

test('a label with markup in it cannot break the document', () => {
  const svg = plotTemperatureFit(samples(5, 65, line), 'x', [0, 0, 0, 0], { label: 'A & B <hack>' })
  assert.match(svg, /A &amp; B &lt;hack&gt;/)
  assert.ok(!svg.includes('<hack>'))
})

test('no samples draws nothing rather than an empty frame', () => {
  const empty = { temperature: [], x: [], y: [], z: [] }
  assert.equal(plotTemperatureFit(empty, 'x', [0, 0, 0, 0], { label: 'Gyro X' }), '')
})

test('a flat sweep does not divide by its own zero range', () => {
  // Every sample at one temperature: the plot has nothing to show, but it
  // must not produce NaN coordinates.
  const flat = { temperature: [30, 30, 30], x: [1, 1, 1], y: [1, 1, 1], z: [1, 1, 1] }
  const svg = plotTemperatureFit(flat, 'x', [0, 0, 0, 1], { label: 'Gyro X' })
  assert.ok(!svg.includes('NaN'), svg.slice(0, 200))
})
