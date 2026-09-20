/**
 * Resolving a named value to the number a parameter actually takes.
 *
 * Several steps set a parameter from a component's own words -- FRAME_CLASS
 * from `'Quad'`, GPS_TYPE from the receiver's protocol -- because that is what
 * the operator declared. Turning those into numbers needs ArduPilot's parameter
 * documentation, so the sequence cannot be evaluated from the step files alone.
 *
 * The lookup is an interface rather than a bundled table: ArduConfigurator
 * already ships this metadata per vehicle, and duplicating it here would mean
 * two copies drifting apart.
 */

/** One documented parameter. `bitmask` means the option values are bit positions. */
export interface ParameterDoc {
  readonly options?: readonly { readonly value: number; readonly label: string }[]
  readonly bitmask?: boolean
}

export type ParameterDocs = (parameter: string) => ParameterDoc | undefined

/**
 * Parameters that carry the same choice under a different name.
 *
 * A quadplane's motor PWM type is `Q_M_PWM_TYPE`; Plane has no `MOT_PWM_TYPE`
 * at all. AMC resolves this the same way -- it prefers Q_M_PWM_TYPE's values
 * when the firmware has them -- so the sequence's `MOT_PWM_TYPE` directive can
 * be answered from the parameter the vehicle actually has.
 */
export const ALIASES: Readonly<Record<string, readonly string[]>> = {
  MOT_PWM_TYPE: ['Q_M_PWM_TYPE'],
  GPS_TYPE: ['GPS1_TYPE'],
  GPS1_TYPE: ['GPS_TYPE']
}

/**
 * Adapt a record of parameter documentation, as ArduConfigurator generates it
 * in `apps/web/src/generated/param-upstream/<vehicle>.json`.
 */
export function parameterDocsFrom(record: Readonly<Record<string, ParameterDoc>>): ParameterDocs {
  return (parameter) => record[parameter]
}

export class UnresolvableValueError extends Error {
  constructor(
    readonly parameter: string,
    readonly label: string,
    readonly reason: 'undocumented' | 'unknown-label'
  ) {
    super(
      reason === 'undocumented'
        ? `${parameter}: no documentation metadata available, cannot resolve '${label}'`
        : `${parameter}: '${label}' is not one of its documented values`
    )
    this.name = 'UnresolvableValueError'
  }
}

/**
 * Compare a documented option label with the name a component declares.
 *
 * ArduPilot's labels sometimes carry a parenthetical list of the hardware a
 * value covers -- `INA2XX (INA226 INA228 INA238 INA231 INA260)` -- while a
 * vehicle declares the bare name. Comparing only the part before the
 * parenthesis matches the two without loosening anything else: the leading
 * name still has to be exactly right.
 */
function labelMatches(optionLabel: string, wanted: string): boolean {
  if (optionLabel === wanted) return true
  const bare = optionLabel.split('(')[0]?.trim()
  return bare !== undefined && bare.length > 0 && bare === wanted
}

/** The parameter's own doc, or an alias's, whichever this firmware carries. */
function docWithOptions(parameter: string, docs: ParameterDocs): ParameterDoc | undefined {
  const own = docs(parameter)
  if (own?.options && own.options.length > 0) return own
  for (const alias of ALIASES[parameter] ?? []) {
    const aliased = docs(alias)
    if (aliased?.options && aliased.options.length > 0) return aliased
  }
  return own
}

/**
 * Resolve a named value against a parameter's documented options.
 *
 * A bitmask parameter's options are bit positions, so the named bit becomes
 * `2 ** bit` rather than the bit number itself -- setting RC_PROTOCOLS to
 * `'PPM'` (bit 1) means writing 2, not 1.
 */
export function resolveNamedValue(parameter: string, label: string, docs: ParameterDocs): number {
  const doc = docWithOptions(parameter, docs)
  if (!doc?.options) throw new UnresolvableValueError(parameter, label, 'undocumented')
  const match = doc.options.find((option) => labelMatches(option.label, label))
  if (!match) throw new UnresolvableValueError(parameter, label, 'unknown-label')
  return doc.bitmask === true ? 2 ** match.value : match.value
}
