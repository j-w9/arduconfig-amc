/**
 * Where a component field's choices come from.
 *
 * Most of these fields are enumerations, not free text: an ESC protocol is one
 * of a known set, and typing it by hand invites a value the sequence cannot
 * resolve. AMC's own editor builds those lists from ArduPilot's parameter
 * documentation, and the mapping from field to parameter is already stated in
 * the step files -- FRAME_CLASS's value *is*
 * `vehicle_components['Frame']['Specifications']['Frame class']`.
 *
 * So the lists are derived rather than maintained: a directive whose value is a
 * bare read of one component field declares that the field supplies that
 * parameter, and the parameter's documented values are the field's choices.
 */

import { type Node, parse } from '@arduconfig/amc-expr'

import type { ComponentPath } from './components.js'
import type { ParameterDocs } from './docs.js'
import { directivesOf } from './load.js'
import type { ConfigurationStep } from './types.js'

/** The component path an expression reads, if it reads exactly one and nothing else. */
function soleComponentPath(node: Node): ComponentPath | undefined {
  const segments: string[] = []
  let current = node
  while (current.kind === 'index') {
    if (current.key.kind !== 'str') return undefined
    segments.unshift(current.key.value)
    current = current.target
  }
  if (current.kind !== 'name' || current.id !== 'vehicle_components') return undefined
  return segments.length > 0 ? segments : undefined
}

/**
 * Map each component field to the parameters it supplies, most-specific first.
 *
 * A field can feed more than one parameter (GPS_TYPE and GPS1_TYPE are the same
 * choice before and after 4.6), so the caller takes the first that is
 * documented.
 */
export function componentOptionSources(steps: Iterable<ConfigurationStep>): Map<string, string[]> {
  const sources = new Map<string, string[]>()
  for (const step of steps) {
    for (const { parameter, directive } of directivesOf(step)) {
      const value = directive['New Value']
      if (typeof value !== 'string') continue
      let path: ComponentPath | undefined
      try {
        path = soleComponentPath(parse(value))
      } catch {
        // An expression that will not parse cannot declare anything.
        continue
      }
      if (!path) continue
      const key = path.join('/')
      const existing = sources.get(key)
      if (!existing) sources.set(key, [parameter])
      else if (!existing.includes(parameter)) existing.push(parameter)
    }
  }
  return sources
}

/**
 * The choices for one field, or undefined when it is not an enumeration.
 *
 * Undefined is the honest answer for a free-text or numeric field -- a
 * propeller diameter has no list -- and for a parameter this vehicle's
 * documentation does not carry.
 */
export function optionsForField(
  path: ComponentPath,
  sources: ReadonlyMap<string, string[]>,
  docs: ParameterDocs
): string[] | undefined {
  const parameters = sources.get(path.join('/'))
  if (!parameters) return undefined
  for (const parameter of parameters) {
    const doc = docs(parameter)
    if (doc?.options && doc.options.length > 0) return doc.options.map((option) => option.label)
  }
  return undefined
}
