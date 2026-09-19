// The places where Python and JavaScript quietly disagree.
//
// The corpus test proves parity over today's step files; this one pins the
// individual rules, so a regression names the rule it broke instead of pointing
// at whichever vehicle template happened to expose it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PyError, evaluate, fromJsonText, fromParameterMap, evaluateIn } from '../packages/amc-expr/dist/index.js'

const run = (expr, scope = {}) => evaluate(expr, scope)
const value = (expr, scope = {}) => run(expr, scope).v
const type = (expr, scope = {}) => run(expr, scope).t

test('round() is half-to-even, not half-up', () => {
  assert.equal(value('round(0.5)'), 0)
  assert.equal(value('round(1.5)'), 2)
  assert.equal(value('round(2.5)'), 2)
  assert.equal(value('round(-0.5)'), -0)
  assert.equal(value('round(-1.5)'), -2)
})

test('round() works on the exact value, not a scaled one', () => {
  // 5.55 is really 5.54999..., so it rounds down despite looking like a tie.
  assert.equal(value('round(5.55, 1)'), 5.5)
  assert.equal(value('round(2.675, 2)'), 2.67)
  // 0.125 is exact, so half-to-even applies for real.
  assert.equal(value('round(0.125, 2)'), 0.12)
  assert.equal(value('round(0.375, 2)'), 0.38)
})

test('round() returns an int with one argument and keeps the type with two', () => {
  assert.equal(type('round(1.7)'), 'int')
  assert.equal(type('round(27000, -2)'), 'int')
  assert.equal(type('round(1.75, 1)'), 'float')
  assert.equal(value('round(27050, -2)'), 27000)
})

test('int arithmetic stays int, and true division never does', () => {
  assert.equal(type('2 + 2'), 'int')
  assert.equal(type('2.0 + 2'), 'float')
  assert.equal(type('4 / 2'), 'float')
  assert.equal(type('4 // 3'), 'int')
  assert.equal(type('2 ** 3'), 'int')
  assert.equal(type('2 ** -1'), 'float')
})

test('floor division and modulo follow the divisor sign', () => {
  assert.equal(value('-7 // 2'), -4)
  assert.equal(value('-7 % 3'), 2)
  assert.equal(value('7 % -3'), -2)
})

test('int() truncates toward zero rather than flooring', () => {
  assert.equal(value('int(1.9)'), 1)
  assert.equal(value('int(-1.9)'), -1)
  assert.equal(type('int(1.9)'), 'int')
})

test('shifting is exact past 32 bits, where JS would wrap', () => {
  assert.equal(value('1 << 40'), 1099511627776)
  assert.equal(value('1 << 3'), 8)
})

test('dividing by zero raises rather than yielding Infinity', () => {
  assert.throws(() => run('1 / 0'), (e) => e instanceof PyError && e.pyType === 'ZeroDivisionError')
  assert.throws(() => run('0 ** -1'), (e) => e instanceof PyError && e.pyType === 'ZeroDivisionError')
})

test('a missing parameter raises KeyError, not undefined', () => {
  const scope = { fc_parameters: { BRD_HEAT_TARG: 65 } }
  assert.equal(value("fc_parameters['BRD_HEAT_TARG']", scope), 65)
  assert.throws(
    () => run("fc_parameters['NOPE']", scope),
    (e) => e instanceof PyError && e.pyType === 'KeyError'
  )
  // Which is why the step files guard with `in` first.
  assert.equal(value("'NOPE' in fc_parameters", scope), false)
  assert.equal(value("'NOPE' not in fc_parameters", scope), true)
})

test('and/or yield an operand, not a coerced boolean', () => {
  assert.equal(value('0 or 5'), 5)
  assert.equal(value("'' or 'fallback'"), 'fallback')
  assert.equal(value('3 and 4'), 4)
  assert.equal(value('0 and 4'), 0)
})

test('in means key on a dict, substring on a string, member on a list', () => {
  const scope = { d: { a: 1 }, s: 'F405', l: ['DShot600'] }
  assert.equal(value("'a' in d", scope), true)
  assert.equal(value("'F4' in s", scope), true)
  assert.equal(value("'DShot600' in l", scope), true)
  assert.equal(value("'DShot150' in l", scope), false)
})

test('ternaries chain right-associatively', () => {
  assert.equal(value("1 if False else 2 if False else 3"), 3)
  assert.equal(value("1 if False else 2 if True else 3"), 2)
})

test('Version compares by segment, not lexically', () => {
  assert.equal(value("Version('4.10') > Version('4.6')"), true)
  assert.equal(value("Version('4.6.0') == Version('4.6')"), true)
  assert.equal(value("Version('4.5') < Version('4.6')"), true)
})

test('JSON keeps 4.0 apart from 4', () => {
  const doc = fromJsonText('{"whole": 4, "measured": 4.0}')
  assert.equal(doc.v.get('whole').t, 'int')
  assert.equal(doc.v.get('measured').t, 'float')
  const scope = new Map([['c', doc]])
  assert.equal(evaluateIn("c['whole'] * 4", scope).t, 'int')
  assert.equal(evaluateIn("c['measured'] * 4", scope).t, 'float')
})

test('flight controller parameters are always floats', () => {
  const scope = new Map([['fc_parameters', fromParameterMap({ EK3_PRIMARY: 0, MOT_SPIN_MAX: 0.95 })]])
  assert.equal(evaluateIn("fc_parameters['EK3_PRIMARY']", scope).t, 'float')
  // Which is why the step files wrap them in int() before shifting.
  assert.equal(evaluateIn("1 << int(fc_parameters['EK3_PRIMARY'])", scope).v, 1)
})

test('a malformed expression is rejected at parse time', () => {
  assert.throws(() => run('1 +'), (e) => e instanceof PyError && e.pyType === 'SyntaxError')
  assert.throws(() => run("__import__('os')"), (e) => e instanceof PyError && e.pyType === 'NameError')
  assert.throws(() => run("(1).__class__"), (e) => e instanceof PyError)
})
