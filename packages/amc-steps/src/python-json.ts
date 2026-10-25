/**
 * JSON read and written the way Python's `json` module does it.
 *
 * AMC rewrites `vehicle_components.json` with `json.dumps(data, indent=4)` when
 * it migrates a project. Re-serialising with `JSON.stringify` gives a different
 * file: `30.0` comes out as `30`, a key like `"1"` jumps to the front of its
 * object, and `é` stays `é` where Python writes `é`. Each of those would
 * show up as a change the operator never made, so this keeps Python's model --
 * ordered keys, ints distinct from floats -- and Python's spelling of each.
 */

export type PyValue =
  | null
  | boolean
  | string
  | PyInt
  | PyFloat
  | readonly PyValue[]
  | PyObject

/** An integer, kept as its digits: Python's ints have no precision limit. */
export interface PyInt {
  readonly kind: 'int'
  readonly digits: string
}

export interface PyFloat {
  readonly kind: 'float'
  readonly value: number
}

/** A dict: insertion-ordered, and a repeated key keeps its first position. */
export class PyObject {
  readonly entries = new Map<string, PyValue>()
  get(key: string): PyValue | undefined {
    return this.entries.get(key)
  }
  set(key: string, value: PyValue): void {
    this.entries.set(key, value)
  }
}

export const pyInt = (value: number): PyInt => ({ kind: 'int', digits: String(Math.trunc(value)) })

function isInt(value: PyValue): value is PyInt {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as PyInt).kind === 'int'
}

function isFloat(value: PyValue): value is PyFloat {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as PyFloat).kind === 'float'
}

/** The number a value holds, if it is one. */
export function pyNumber(value: PyValue | undefined): number | undefined {
  if (value === undefined) return undefined
  if (isInt(value)) return Number(value.digits)
  if (isFloat(value)) return value.value
  return undefined
}

/** Whether a value is an int in Python's sense (bool excluded, as JSON has no bool-as-int). */
export function pyIsInt(value: PyValue | undefined): value is PyInt {
  return value !== undefined && isInt(value)
}

/** `json.loads`. Throws on anything Python would reject. */
export function pyJsonLoads(text: string): PyValue {
  let at = 0
  const fail = (what: string): never => {
    throw new SyntaxError(`${what} at offset ${at}`)
  }
  // Python's json skips exactly these four between tokens.
  const space = () => {
    while (at < text.length && ' \t\n\r'.includes(text[at] as string)) at++
  }
  const value = (): PyValue => {
    space()
    const c = text[at]
    if (c === '{') {
      at++
      const object = new PyObject()
      space()
      if (text[at] === '}') {
        at++
        return object
      }
      for (;;) {
        space()
        if (text[at] !== '"') fail('expected a key')
        const key = string()
        space()
        if (text[at] !== ':') fail("expected ':'")
        at++
        object.set(key, value())
        space()
        if (text[at] === ',') {
          at++
          continue
        }
        if (text[at] === '}') {
          at++
          return object
        }
        fail("expected ',' or '}'")
      }
    }
    if (c === '[') {
      at++
      const list: PyValue[] = []
      space()
      if (text[at] === ']') {
        at++
        return list
      }
      for (;;) {
        list.push(value())
        space()
        if (text[at] === ',') {
          at++
          continue
        }
        if (text[at] === ']') {
          at++
          return list
        }
        fail("expected ',' or ']'")
      }
    }
    if (c === '"') return string()
    for (const [word, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
      ['NaN', { kind: 'float', value: Number.NaN }],
      ['Infinity', { kind: 'float', value: Number.POSITIVE_INFINITY }],
      ['-Infinity', { kind: 'float', value: Number.NEGATIVE_INFINITY }]
    ] as const) {
      if (text.startsWith(word, at)) {
        at += word.length
        return result as PyValue
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/.exec(text.slice(at))
    if (!number) return fail('unexpected character')
    at += number[0].length
    if (number[1] === undefined && number[2] === undefined) return { kind: 'int', digits: number[0] }
    return { kind: 'float', value: Number(number[0]) }
  }
  const string = (): string => {
    at++ // opening quote
    let out = ''
    for (;;) {
      const c = text[at]
      if (c === undefined) fail('unterminated string')
      if (c === '"') {
        at++
        return out
      }
      if (c === '\\') {
        const e = text[at + 1]
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (e !== undefined && e in simple) {
          out += simple[e]
          at += 2
          continue
        }
        if (e === 'u') {
          const hex = text.slice(at + 2, at + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad \\u escape')
          out += String.fromCharCode(parseInt(hex, 16))
          at += 6
          continue
        }
        fail('bad escape')
      }
      // Python's strict mode rejects raw control characters inside strings.
      if ((c as string) < ' ') fail('control character in string')
      out += c
      at++
    }
  }
  const result = value()
  space()
  if (at !== text.length) fail('extra data')
  return result
}

/** Python's `repr(float)`: the shortest round-trip digits, in Python's layout. */
export function pyFloatRepr(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Number.POSITIVE_INFINITY) return 'Infinity'
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity'
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0'
  // toExponential() with no argument gives exactly the shortest digits that
  // round-trip, the same digits Python's repr chooses.
  const [mantissa, exponentText] = value.toExponential().split('e') as [string, string]
  const negative = mantissa.startsWith('-')
  const digits = mantissa.replace('-', '').replace('.', '')
  const exponent = Number(exponentText)
  let body: string
  // repr switches to scientific notation outside 1e-4 <= |x| < 1e16.
  if (exponent < -4 || exponent >= 16) {
    const rest = digits.slice(1)
    const sign = exponent < 0 ? '-' : '+'
    const magnitude = String(Math.abs(exponent)).padStart(2, '0')
    body = `${digits[0]}${rest ? `.${rest}` : ''}e${sign}${magnitude}`
  } else if (exponent < 0) {
    body = `0.${'0'.repeat(-exponent - 1)}${digits}`
  } else {
    const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0')
    const fraction = digits.slice(exponent + 1)
    body = `${whole}.${fraction || '0'}`
  }
  return negative ? `-${body}` : body
}

/** A string as `json.dumps` writes it with the default `ensure_ascii=True`. */
function pyString(value: string): string {
  let out = '"'
  for (let i = 0; i < value.length; i++) {
    const c = value[i] as string
    const code = c.charCodeAt(0)
    if (c === '"') out += '\\"'
    else if (c === '\\') out += '\\\\'
    else if (c === '\n') out += '\\n'
    else if (c === '\r') out += '\\r'
    else if (c === '\t') out += '\\t'
    else if (c === '\b') out += '\\b'
    else if (c === '\f') out += '\\f'
    // Everything else outside printable ASCII is \u-escaped, a UTF-16 unit at
    // a time -- which writes an astral character as its surrogate pair, as
    // Python does.
    else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += c
  }
  return `${out}"`
}

/** `json.dumps(value, indent=indent)`. */
export function pyJsonDumps(value: PyValue, indent = 4): string {
  const write = (v: PyValue, depth: number): string => {
    if (v === null) return 'null'
    if (v === true) return 'true'
    if (v === false) return 'false'
    if (typeof v === 'string') return pyString(v)
    if (isInt(v)) return v.digits === '-0' ? '0' : v.digits
    if (isFloat(v)) return pyFloatRepr(v.value)
    const inner = '\n' + ' '.repeat(indent * (depth + 1))
    const outer = '\n' + ' '.repeat(indent * depth)
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      return `[${v.map((item) => inner + write(item, depth + 1)).join(',')}${outer}]`
    }
    const object = v as PyObject
    if (object.entries.size === 0) return '{}'
    const parts = [...object.entries].map(([key, item]) => `${inner}${pyString(key)}: ${write(item, depth + 1)}`)
    return `{${parts.join(',')}${outer}}`
  }
  return write(value, 0)
}
