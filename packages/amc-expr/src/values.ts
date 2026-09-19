/**
 * The Python value model the configuration-step expressions are written in.
 *
 * JavaScript has one number type; Python has two, and the difference reaches
 * the flight controller -- `round()` yields an int, `/` always yields a float,
 * and `1 << int(x)` is meaningless without int semantics. So values carry their
 * Python type rather than being raw JS values, and unwrapping happens only at
 * the boundary.
 */

export type PyValue =
  | { readonly t: 'int'; readonly v: number }
  | { readonly t: 'float'; readonly v: number }
  | { readonly t: 'str'; readonly v: string }
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'none' }
  | { readonly t: 'list'; readonly v: readonly PyValue[] }
  | { readonly t: 'dict'; readonly v: ReadonlyMap<string, PyValue> }
  | { readonly t: 'version'; readonly v: string }

/** Python exception names, preserved so failures read the same as upstream's. */
export type PyErrorName =
  | 'KeyError'
  | 'TypeError'
  | 'ValueError'
  | 'NameError'
  | 'ZeroDivisionError'
  | 'IndexError'
  | 'SyntaxError'
  | 'OverflowError'

export class PyError extends Error {
  constructor(
    readonly pyType: PyErrorName,
    message: string
  ) {
    super(`${pyType}: ${message}`)
    this.name = 'PyError'
  }
}

export const int = (v: number): PyValue => ({ t: 'int', v })
export const float = (v: number): PyValue => ({ t: 'float', v })
export const str = (v: string): PyValue => ({ t: 'str', v })
export const bool = (v: boolean): PyValue => ({ t: 'bool', v })
export const NONE: PyValue = { t: 'none' }

export function isNumeric(value: PyValue): value is { t: 'int' | 'float'; v: number } {
  return value.t === 'int' || value.t === 'float'
}

/**
 * Python's truthiness: zero, empty string, empty container and None are false.
 */
export function truthy(value: PyValue): boolean {
  switch (value.t) {
    case 'bool':
      return value.v
    case 'int':
    case 'float':
      return value.v !== 0
    case 'str':
      return value.v.length > 0
    case 'list':
      return value.v.length > 0
    case 'dict':
      return value.v.size > 0
    case 'none':
      return false
    case 'version':
      return true
  }
}

/** Name a value's type the way a Python error message would. */
export function typeName(value: PyValue): string {
  switch (value.t) {
    case 'version':
      return 'Version'
    case 'none':
      return 'NoneType'
    default:
      return value.t
  }
}

/**
 * Wrap plain JSON -- the vehicle_components document and the fc_parameters
 * mapping -- as Python values.
 *
 * JSON numbers carry no int/float mark, so the JS integrality of the number
 * decides, which matches how Python's json module loads the same file.
 */
export function fromJson(input: unknown): PyValue {
  if (input === null || input === undefined) return NONE
  if (typeof input === 'boolean') return bool(input)
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return float(input)
    return Number.isInteger(input) ? int(input) : float(input)
  }
  if (typeof input === 'string') return str(input)
  if (Array.isArray(input)) return { t: 'list', v: input.map(fromJson) }
  if (typeof input === 'object') {
    const entries = new Map<string, PyValue>()
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      entries.set(key, fromJson(value))
    }
    return { t: 'dict', v: entries }
  }
  throw new PyError('TypeError', `cannot represent ${typeof input}`)
}

/** Unwrap back to plain JS, for callers that do not care about int vs float. */
export function toJs(value: PyValue): unknown {
  switch (value.t) {
    case 'none':
      return null
    case 'list':
      return value.v.map(toJs)
    case 'dict':
      return Object.fromEntries([...value.v].map(([k, v]) => [k, toJs(v)]))
    default:
      return value.v
  }
}
