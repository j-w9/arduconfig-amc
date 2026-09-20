/**
 * Loading and traversing a configuration-step file.
 *
 * The sequence is ordered by the step filenames' numeric prefix rather than by
 * object key order, so a file that is edited or re-serialised cannot silently
 * reorder the configuration a vehicle is taken through.
 */
/** `05_board_orientation.param` sorts by its 05, not by its text. */
function sequenceNumber(filename) {
    const match = /^(\d+)/.exec(filename);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
export function orderSteps(file) {
    const names = Object.keys(file.steps).sort((a, b) => {
        const diff = sequenceNumber(a) - sequenceNumber(b);
        return diff !== 0 ? diff : a.localeCompare(b);
    });
    // Phases are declared by the index at which they start and run until the next.
    const boundaries = Object.entries(file.phases ?? {})
        .map(([name, phase]) => ({ name, start: phase.start ?? 0 }))
        .sort((a, b) => a.start - b.start);
    return names.map((filename, index) => {
        let phase;
        for (const boundary of boundaries) {
            if (index >= boundary.start)
                phase = boundary.name;
            else
                break;
        }
        const step = file.steps[filename];
        return phase === undefined ? { filename, index, step } : { filename, index, step, phase };
    });
}
/** The four directive groups, in the order AMC applies them. */
export const DIRECTIVE_GROUPS = [
    'derived_parameters',
    'forced_parameters',
    'add_parameters',
    'delete_parameters'
];
/** Every parameter directive in a step, flattened with its group. */
export function directivesOf(step) {
    const refs = [];
    for (const group of DIRECTIVE_GROUPS) {
        const directives = step[group];
        if (!directives)
            continue;
        for (const [parameter, directive] of Object.entries(directives)) {
            refs.push({ group, parameter, directive });
        }
    }
    return refs;
}
/**
 * Every expression a step will evaluate -- guards and values alike.
 *
 * A numeric `New Value` is a literal rather than an expression, so it is not
 * returned here.
 */
export function expressionsOf(step) {
    const found = [];
    for (const { directive } of directivesOf(step)) {
        if (directive.if)
            found.push(directive.if);
        const value = directive['New Value'];
        if (typeof value === 'string')
            found.push(value);
    }
    return found;
}
/** The groups whose directives always state a value. */
export const VALUED_GROUPS = ['derived_parameters', 'forced_parameters'];
/** Parse a step file, rejecting anything without the `steps` mapping. */
export function parseStepFile(text) {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || !('steps' in parsed)) {
        throw new Error('not a configuration-step file: missing "steps"');
    }
    const steps = parsed.steps;
    if (typeof steps !== 'object' || steps === null) {
        throw new Error('not a configuration-step file: "steps" is not an object');
    }
    return parsed;
}
