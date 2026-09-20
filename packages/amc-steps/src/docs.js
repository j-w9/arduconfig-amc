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
/**
 * Adapt a record of parameter documentation, as ArduConfigurator generates it
 * in `apps/web/src/generated/param-upstream/<vehicle>.json`.
 */
export function parameterDocsFrom(record) {
    return (parameter) => record[parameter];
}
export class UnresolvableValueError extends Error {
    parameter;
    label;
    reason;
    constructor(parameter, label, reason) {
        super(reason === 'undocumented'
            ? `${parameter}: no documentation metadata available, cannot resolve '${label}'`
            : `${parameter}: '${label}' is not one of its documented values`);
        this.parameter = parameter;
        this.label = label;
        this.reason = reason;
        this.name = 'UnresolvableValueError';
    }
}
/**
 * Resolve a named value against a parameter's documented options.
 *
 * A bitmask parameter's options are bit positions, so the named bit becomes
 * `2 ** bit` rather than the bit number itself -- setting RC_PROTOCOLS to
 * `'PPM'` (bit 1) means writing 2, not 1.
 */
export function resolveNamedValue(parameter, label, docs) {
    const doc = docs(parameter);
    if (!doc?.options)
        throw new UnresolvableValueError(parameter, label, 'undocumented');
    const match = doc.options.find((option) => option.label === label);
    if (!match)
        throw new UnresolvableValueError(parameter, label, 'unknown-label');
    return doc.bitmask === true ? 2 ** match.value : match.value;
}
