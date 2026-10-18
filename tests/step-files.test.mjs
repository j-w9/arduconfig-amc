import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseStepFile, stepFiles } from '../packages/amc-steps/dist/index.js'

/*
 * AMC v4.5.x let a step's download_file and upload_file be a list as well as
 * a single object, and moved every step that installs a file over to the list
 * form. The port typed them as one object, so reading .source_url off the new
 * shape gave `undefined` -- and in-flight magfit, which now needs two scripts,
 * could never have installed both. Nothing failed: the field was simply read
 * as missing. These lock the normalization.
 */

const step = (fields) => parseStepFile(JSON.stringify({ steps: { '01_x.param': fields } })).steps['01_x.param']

test('the original single-object form still reads', () => {
  const files = stepFiles(
    step({
      download_file: { source_url: 'https://example.org/a.lua', dest_local: 'a.lua' },
      upload_file: { source_local: 'a.lua', dest_on_fc: '/APM/Scripts/a.lua' }
    })
  )
  assert.deepEqual(files, [{ url: 'https://example.org/a.lua', name: 'a.lua', destination: '/APM/Scripts/a.lua' }])
})

test('the list form yields every file, each with its own source', () => {
  const files = stepFiles(
    step({
      download_file: [
        { source_url: 'https://example.org/a.lua', dest_local: 'a.lua' },
        { source_url: 'https://example.org/b.lua', dest_local: 'b.lua' }
      ],
      upload_file: [
        { source_local: 'a.lua', dest_on_fc: '/APM/Scripts/a.lua' },
        { source_local: 'b.lua', dest_on_fc: '/APM/Scripts/b.lua' }
      ]
    })
  )
  assert.deepEqual(files, [
    { url: 'https://example.org/a.lua', name: 'a.lua', destination: '/APM/Scripts/a.lua' },
    { url: 'https://example.org/b.lua', name: 'b.lua', destination: '/APM/Scripts/b.lua' }
  ])
})

test('pairs by file name, not by position', () => {
  // The download and upload lists are separate, and nothing promises they
  // are in the same order.
  const files = stepFiles(
    step({
      download_file: [
        { source_url: 'https://example.org/b.lua', dest_local: 'b.lua' },
        { source_url: 'https://example.org/a.lua', dest_local: 'a.lua' }
      ],
      upload_file: [{ source_local: 'a.lua', dest_on_fc: '/APM/Scripts/a.lua' }]
    })
  )
  assert.equal(files[0].url, 'https://example.org/a.lua')
})

test('reports an upload nothing in the step can fetch, rather than dropping it', () => {
  const files = stepFiles(step({ upload_file: { source_local: 'mine.lua', dest_on_fc: '/APM/Scripts/mine.lua' } }))
  assert.deepEqual(files, [{ name: 'mine.lua', destination: '/APM/Scripts/mine.lua' }])
})

test('a step that installs nothing has no files', () => {
  assert.deepEqual(stepFiles(step({})), [])
})

test('every installing step AMC ships resolves every file it uploads', () => {
  // The real data, every vehicle: no upload may be left without a source,
  // and magfit's two scripts must both be there.
  for (const kind of ['ArduCopter', 'ArduPlane', 'Heli', 'Rover']) {
    const { steps } = parseStepFile(readFileSync(new URL(`../steps/configuration_steps_${kind}.json`, import.meta.url), 'utf8'))
    for (const [filename, s] of Object.entries(steps)) {
      for (const file of stepFiles(s)) {
        assert.ok(file.url, `${kind} ${filename}: ${file.name} has no download`)
        assert.match(file.url, /^https:\/\//, `${kind} ${filename}`)
      }
    }
    const magfit = stepFiles(steps['31_inflight_magnetometer_fit_setup.param']).map((f) => f.name)
    assert.ok(magfit.length >= 2, `${kind} magfit should install both of its scripts, got ${magfit}`)
  }
})
