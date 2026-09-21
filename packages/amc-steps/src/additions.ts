/**
 * Parameters the operator adds to a step themselves.
 *
 * AMC's step files are editable: `add_parameter_to_current_file` lets you put
 * any parameter into any step, with your own reason, and it is written into
 * the directory beside the ones the sequence computed. That is how a vehicle's
 * own settings get recorded against the step they belong to -- the serial baud
 * rate for the telemetry step, the antenna offset for the GNSS one -- none of
 * which the sequence decides.
 *
 * It is the other half of naming what the sequence does not decide. Telling an
 * operator that a step usually sets `SERIAL1_BAUD` and then giving them
 * nowhere to put their answer would be worse than not telling them.
 */

import type { ParameterDocs } from './docs.js'

export interface Addition {
  readonly value: number
  readonly reason?: string
}

/** Added parameters, by step filename and then by parameter name. */
export type Additions = ReadonlyMap<string, ReadonlyMap<string, Addition>>

/** Why a name cannot be added, in the operator's terms. */
export type AdditionProblem =
  | { readonly kind: 'empty' }
  | { readonly kind: 'malformed'; readonly name: string }
  | { readonly kind: 'present'; readonly name: string }

/**
 * ArduPilot's own rule for a parameter name.
 *
 * Capital letter first, then capitals, digits and underscores, up to sixteen
 * characters -- the limit the wire protocol imposes
 * (`data_model_par_dict.validate_param_name`).
 */
const PARAM_NAME = /^[A-Z][A-Z0-9_]{0,15}$/

/**
 * Check a name the operator typed.
 *
 * Upper-cased first, as AMC does: parameter names are capitals and typing them
 * in lower case is a keyboard state, not a different parameter.
 */
export function checkAddition(
  raw: string,
  alreadyInStep: Iterable<string>
): { readonly name: string } | { readonly problem: AdditionProblem } {
  const name = raw.trim().toUpperCase()
  if (name.length === 0) return { problem: { kind: 'empty' } }
  if (!PARAM_NAME.test(name)) return { problem: { kind: 'malformed', name } }
  // AMC's message is "Parameter already exists, edit it instead", and the
  // distinction matters: the step is not refusing the parameter, it is
  // pointing at where the value already lives.
  if (new Set(alreadyInStep).has(name)) return { problem: { kind: 'present', name } }
  return { name }
}

export interface AddableOptions {
  /** Parameters already in this step, which cannot be added again. */
  readonly alreadyInStep?: Iterable<string>
  /** The vehicle's parameters, used when there is no documentation. */
  readonly vehicleParameters?: Readonly<Record<string, number>>
  /** Names to offer first, such as the ones AMC's templates set for this step. */
  readonly preferred?: Iterable<string>
}

/**
 * The names worth offering, sorted.
 *
 * AMC draws them from the parameter documentation, falling back to whatever
 * the connected vehicle reports, and removes what the step already has. The
 * `preferred` names come first: having just told the operator which settings
 * this step usually needs, burying them in an alphabetical list of a thousand
 * would be a strange way to follow up.
 */
export function addableParameters(
  docs: ParameterDocs | undefined,
  known: Iterable<string>,
  options: AddableOptions = {}
): readonly string[] {
  const taken = new Set(options.alreadyInStep ?? [])
  const pool = new Set<string>()
  for (const name of known) if (!taken.has(name)) pool.add(name)
  for (const name of Object.keys(options.vehicleParameters ?? {})) {
    if (!taken.has(name)) pool.add(name)
  }

  const preferred: string[] = []
  for (const name of options.preferred ?? []) {
    if (pool.has(name)) {
      preferred.push(name)
      pool.delete(name)
    }
  }
  // `docs` is not consulted for the list -- callers pass the names they have --
  // but keeping it in the signature is deliberate: it is what AMC uses, and a
  // caller with documentation and no vehicle should pass its names as `known`.
  void docs

  return [...preferred.sort(), ...[...pool].sort()]
}

/**
 * The value to start an added parameter at.
 *
 * The vehicle's own, when it has one: the operator is recording what their
 * aircraft holds, not inventing a number. Zero otherwise, which is honest
 * about being a placeholder rather than dressed up as a default.
 */
export function startingValue(
  name: string,
  vehicleParameters: Readonly<Record<string, number>> | undefined
): number {
  const live = vehicleParameters?.[name]
  return typeof live === 'number' && Number.isFinite(live) ? live : 0
}

/** The additions for one step, or an empty map. */
export function additionsFor(additions: Additions | undefined, filename: string): ReadonlyMap<string, Addition> {
  return additions?.get(filename) ?? new Map()
}
