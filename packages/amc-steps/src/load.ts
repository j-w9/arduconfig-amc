/**
 * Loading and traversing a configuration-step file.
 *
 * The sequence is ordered by the step filenames' numeric prefix rather than by
 * object key order, so a file that is edited or re-serialised cannot silently
 * reorder the configuration a vehicle is taken through.
 */

import type {
  ConfigurationPhase,
  ConfigurationStep,
  ConfigurationStepFile,
  OrderedStep,
  ParameterDirective,
  ParameterDirectives
} from './types.js'

/**
 * The number a step file is named by: `05_board_orientation.param` is 5.
 *
 * This is the sequence's own numbering, and it is not the position in the list
 * -- the numbers have gaps, and phase boundaries are given in these terms, not
 * in list positions.
 */
export function stepNumber(filename: string): number {
  const match = /^(\d+)/.exec(filename)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

export function orderSteps(file: ConfigurationStepFile): OrderedStep[] {
  const names = Object.keys(file.steps).sort((a, b) => {
    const diff = stepNumber(a) - stepNumber(b)
    return diff !== 0 ? diff : a.localeCompare(b)
  })

  const boundaries = orderedPhases(file)

  return names.map((filename, index) => {
    const number = stepNumber(filename)
    // The last boundary at or below this step's own number owns it.
    let phase: string | undefined
    for (const boundary of boundaries) {
      if (number >= boundary.start) phase = boundary.name
      else break
    }
    const step = file.steps[filename] as ConfigurationStep
    return phase === undefined ? { filename, index, step } : { filename, index, step, phase }
  })
}

/** The four directive groups, in the order AMC applies them. */
export const DIRECTIVE_GROUPS = [
  'derived_parameters',
  'forced_parameters',
  'add_parameters',
  'delete_parameters'
] as const

export type DirectiveGroup = (typeof DIRECTIVE_GROUPS)[number]

export interface DirectiveRef {
  readonly group: DirectiveGroup
  readonly parameter: string
  readonly directive: ParameterDirective
}

/** Every parameter directive in a step, flattened with its group. */
export function directivesOf(step: ConfigurationStep): DirectiveRef[] {
  const refs: DirectiveRef[] = []
  for (const group of DIRECTIVE_GROUPS) {
    const directives: ParameterDirectives | undefined = step[group]
    if (!directives) continue
    for (const [parameter, directive] of Object.entries(directives)) {
      refs.push({ group, parameter, directive })
    }
  }
  return refs
}

/**
 * Every expression a step will evaluate -- guards and values alike.
 *
 * A numeric `New Value` is a literal rather than an expression, so it is not
 * returned here.
 */
export function expressionsOf(step: ConfigurationStep): string[] {
  const found: string[] = []
  for (const { directive } of directivesOf(step)) {
    if (directive.if) found.push(directive.if)
    const value = directive['New Value']
    if (typeof value === 'string') found.push(value)
  }
  // The connection a step's parameters belong to is an expression like any
  // other, and reads a component field the operator has to declare. Leaving it
  // out meant a step could report needing a field that the form never offered.
  if (typeof step.rename_connection === 'string' && step.rename_connection.trim().length > 0) {
    found.push(step.rename_connection)
  }
  return found
}

/** The groups whose directives always state a value. */
export const VALUED_GROUPS = ['derived_parameters', 'forced_parameters'] as const

/** Parse a step file, rejecting anything without the `steps` mapping. */
export function parseStepFile(text: string): ConfigurationStepFile {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('steps' in parsed)) {
    throw new Error('not a configuration-step file: missing "steps"')
  }
  const steps = (parsed as { steps: unknown }).steps
  if (typeof steps !== 'object' || steps === null) {
    throw new Error('not a configuration-step file: "steps" is not an object')
  }
  return parsed as ConfigurationStepFile
}

/** A phase of the sequence: a named run of steps, by step number. */
export interface OrderedPhase {
  readonly name: string
  readonly description?: string
  /** Declared optional by the sequence -- tuning that not every vehicle needs. */
  readonly optional: boolean
  /** First step number in the phase. */
  readonly start: number
  /** First step number *after* the phase. */
  readonly end: number
}

/**
 * The phases that span steps, in order.
 *
 * A phase without a `start` is documentation rather than a range -- "Assemble
 * all components except the propellers" marks something the operator does
 * between steps, and owns none of them. AMC excludes those from its own phase
 * ranges, and so does this: treating a missing start as 0 would make such a
 * phase swallow the beginning of the sequence.
 */
export function orderedPhases(file: ConfigurationStepFile): OrderedPhase[] {
  const spanning = Object.entries(file.phases ?? {})
    .filter((entry): entry is [string, ConfigurationPhase & { start: number }] => typeof entry[1].start === 'number')
    .sort((left, right) => left[1].start - right[1].start)

  const lastStep = Object.keys(file.steps).reduce((highest, filename) => Math.max(highest, stepNumber(filename)), 0)

  return spanning.map(([name, phase], index) => {
    const next = spanning[index + 1]?.[1].start
    return {
      name,
      optional: phase.optional === true,
      start: phase.start,
      // Ends where the next begins; the last one runs to the end of the sequence.
      end: next ?? lastStep + 1,
      ...(phase.description === undefined || phase.description === name ? {} : { description: phase.description })
    }
  })
}

/** Phases that mark something to do between steps rather than a run of them. */
export function milestonePhases(file: ConfigurationStepFile): { name: string; description?: string }[] {
  return Object.entries(file.phases ?? {})
    .filter(([, phase]) => typeof phase.start !== 'number')
    .map(([name, phase]) => ({
      name,
      ...(phase.description === undefined || phase.description === name ? {} : { description: phase.description })
    }))
}
