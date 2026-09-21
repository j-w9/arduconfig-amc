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

/**
 * The keys INSIDE a step's attributes, one level down.
 *
 * `forced_parameters` is a map of parameter to directive, and the directive's
 * own keys -- `New Value`, `Change Reason`, `if` -- are as much a part of the
 * sequence's data as the attribute holding them. Checking only the top level
 * would let upstream add a key to every directive and have it silently ignored,
 * which is the same way `old_filenames` went unread.
 */
function directiveKeys() {
  const found = new Set()
  for (const file of readdirSync(stepsDir)) {
    if (!file.startsWith('configuration_steps_') || !file.endsWith('.json')) continue
    const parsed = JSON.parse(readFileSync(stepsDir + file, 'utf8'))
    for (const step of Object.values(parsed.steps ?? {})) {
      for (const value of Object.values(step)) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
        for (const inner of Object.values(value)) {
          if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) continue
          for (const key of Object.keys(inner)) found.add(key)
        }
      }
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

test('every key inside a directive is read somewhere', () => {
  // New Value, Change Reason, if — and whatever upstream adds next.
  const source = sources()
  const keys = directiveKeys()
  assert.ok(keys.size >= 3, `only found ${keys.size} directive keys`)
  assert.ok(keys.has('New Value'), 'the scrape missed the key every directive has')

  const unread = [...keys].filter((name) => !source.includes(name)).sort()
  assert.deepEqual(unread, [], `directive keys nothing reads: ${unread.join(', ')}`)
})

test('every phase attribute is read somewhere', () => {
  const source = sources()
  const unread = [...attributesUnder('phases')].filter((name) => !source.includes(name)).sort()
  assert.deepEqual(unread, [], `phase attributes nothing reads: ${unread.join(', ')}`)
})
