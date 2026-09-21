// Every attribute AMC's step files carry, read by something.
//
// The sequence is consumed as data, so an attribute nobody reads is a piece of
// AMC's method silently not happening -- which is what `old_filenames` was
// until it was looked for deliberately, and what a 25th attribute would be
// after the next vendor bump. Cheap enough to be permanent, and the point is
// that it fails on its own rather than waiting to be remembered.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const stepsDir = fileURLToPath(new URL('../steps/', import.meta.url))
const forkSrc = fileURLToPath(new URL('../packages/amc-steps/src/', import.meta.url))
const appSrc = fileURLToPath(new URL('../apps/arduconfigurator/apps/web/src/', import.meta.url))

/** Everything that might read a step, as one blob to look for names in. */
function sources() {
  const parts = []
  for (const dir of [forkSrc, appSrc + 'views/', appSrc + 'view-models/']) {
    for (const file of readdirSync(dir)) {
      if (/\.(ts|tsx)$/.test(file) && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx')) {
        parts.push(readFileSync(dir + file, 'utf8'))
      }
    }
  }
  return parts.join('\n')
}

function attributesUnder(key) {
  const found = new Set()
  for (const file of readdirSync(stepsDir)) {
    if (!file.startsWith('configuration_steps_') || !file.endsWith('.json')) continue
    const parsed = JSON.parse(readFileSync(stepsDir + file, 'utf8'))
    for (const entry of Object.values(parsed[key] ?? {})) {
      for (const attribute of Object.keys(entry)) found.add(attribute)
    }
  }
  return found
}

test('the scrape finds the attributes at all', () => {
  // Otherwise this passes by reading nothing, which is the way an audit rots.
  const attributes = attributesUnder('steps')
  assert.ok(attributes.size >= 20, `only found ${attributes.size} step attributes`)
  assert.ok(attributes.has('forced_parameters'))
})

test('every step attribute is read somewhere', () => {
  const source = sources()
  const unread = [...attributesUnder('steps')].filter((name) => !source.includes(name)).sort()
  assert.deepEqual(unread, [], `step attributes nothing reads: ${unread.join(', ')}`)
})

test('every phase attribute is read somewhere', () => {
  const source = sources()
  const unread = [...attributesUnder('phases')].filter((name) => !source.includes(name)).sort()
  assert.deepEqual(unread, [], `phase attributes nothing reads: ${unread.join(', ')}`)
})
