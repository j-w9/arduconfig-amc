// Parity against upstream: every `if` guard and `New Value` expression in AMC's
// configuration-step files, evaluated against every vendored vehicle template,
// compared to what CPython produced for the same input.
//
// Regenerate the fixture with `npm run fixtures` after `npm run sync`.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

import { PyError, evaluateIn, fromJsonText, fromParameterMap } from '../packages/amc-expr/dist/index.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/expressions.json', import.meta.url), 'utf8'))
const templates = new Map()
for (const name of fixture.contexts) {
  const [vehicle, template] = name.split('/')
  const base = new URL(
    `../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/${vehicle}/${template}/`,
    import.meta.url
  )
  // Loaded through fromJsonText so that a `4.0` in the template stays a float,
  // the way Python's json module reads the same file.
  const document = fromJsonText(readFileSync(new URL('vehicle_components.json', base), 'utf8'))
  const components = document.v.get('Components') ?? { t: 'dict', v: new Map() }
  let fcParameters = {}
  try {
    fcParameters = parseParams(readFileSync(new URL('00_default.param', base), 'utf8'))
  } catch {
    // Templates without a default dump evaluate against an empty parameter set,
    // exactly as the fixture generator treats them.
  }
  templates.set(
    name,
    new Map([
      ['vehicle_components', components],
      ['fc_parameters', fromParameterMap(fcParameters)]
    ])
  )
}

function parseParams(text) {
  const params = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim()
    if (!line) continue
    const match = /^(\S+)[,\s]+(\S+)$/.exec(line)
    if (!match) continue
    const value = Number(match[2])
    if (Number.isNaN(value)) continue
    params[match[1]] = value
  }
  return params
}

/** Floats are compared with tolerance; ints and bools must match exactly. */
function assertSame(actual, expected, expectedType, label) {
  if (expectedType === 'bool') {
    assert.equal(actual.t, 'bool', `${label}: expected a bool, got ${actual.t}`)
    assert.equal(actual.v, expected, label)
    return
  }
  if (expectedType === 'str') {
    assert.equal(actual.t, 'str', `${label}: expected a str, got ${actual.t}`)
    assert.equal(actual.v, expected, label)
    return
  }
  if (expectedType === 'int') {
    assert.equal(actual.t, 'int', `${label}: expected an int, got ${actual.t} (${actual.v})`)
    assert.equal(actual.v, expected, label)
    return
  }
  if (expectedType === 'float') {
    assert.equal(actual.t, 'float', `${label}: expected a float, got ${actual.t} (${actual.v})`)
    const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-12)
    assert.ok(
      Math.abs(actual.v - expected) <= tolerance,
      `${label}: ${actual.v} !== ${expected}`
    )
    return
  }
  assert.fail(`${label}: unhandled expected type ${expectedType}`)
}

test('every step expression matches CPython across every vehicle template', () => {
  const failures = []
  for (const testCase of fixture.cases) {
    const scope = templates.get(testCase.context)
    const label = `[${testCase.context}] ${testCase.expr}`
    try {
      const actual = evaluateIn(testCase.expr, scope)
      if ('error' in testCase) {
        failures.push(`${label}\n  expected ${testCase.error}, got ${actual.t} ${JSON.stringify(actual.v)}`)
        continue
      }
      assertSame(actual, testCase.value, testCase.type, label)
    } catch (error) {
      if ('error' in testCase && error instanceof PyError) {
        if (error.pyType !== testCase.error) {
          failures.push(`${label}\n  expected ${testCase.error}, raised ${error.pyType}`)
        }
        continue
      }
      failures.push(`${label}\n  ${error.message}`)
    }
  }
  assert.equal(
    failures.length,
    0,
    `${failures.length} of ${fixture.cases.length} cases diverged from CPython:\n\n${failures.slice(0, 15).join('\n')}`
  )
})

test('the fixture covers the whole step corpus', () => {
  assert.ok(fixture.cases.length > 2000, `only ${fixture.cases.length} cases`)
  assert.equal(fixture.cases.length, fixture.expressions * fixture.contexts.length)
})

test('the fixture is the CURRENT step files, not an older set of them', () => {
  // The check above is internal consistency: it would hold just as well over a
  // corpus generated before upstream added an expression. Nothing compared it
  // to the steps on disk, so a vendor bump could have left every parity
  // assertion running against a set of expressions that no longer existed.
  //
  // Counted exactly the way scripts/gen_expr_fixtures.py counts: the `if` and
  // `New Value` keys, anywhere in the document, deduplicated.
  const seen = new Set()
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const value of node) walk(value)
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'if' || key === 'New Value') && typeof value === 'string') seen.add(value)
      walk(value)
    }
  }
  const stepsDir = new URL('../steps/', import.meta.url)
  for (const name of readdirSync(stepsDir)) {
    if (!name.startsWith('configuration_steps_') || !name.endsWith('.json')) continue
    if (name.includes('schema')) continue
    walk(JSON.parse(readFileSync(new URL(name, stepsDir), 'utf8')))
  }

  assert.equal(
    fixture.expressions,
    seen.size,
    `the fixture holds ${fixture.expressions} expressions and the step files hold ${seen.size} — run \`npm run sync && npm run fixtures\``
  )
})
