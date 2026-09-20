/**
 * Turning a configuration step into the parameter changes it asks for.
 *
 * Each directive is guarded by an optional `if` expression and carries either
 * an expression or a literal value. Evaluation can fail -- a guard may read a
 * component the operator has not declared yet -- and a half-applied step is
 * worse than a reported one, so failures are collected rather than thrown. The
 * caller decides whether an incomplete step may still be written.
 */
import { PyError, evaluate, fromJsonText, fromParameterMap } from '@arduconfig/amc-expr';
import { evaluateIn } from '@arduconfig/amc-expr';
import { UnresolvableValueError, resolveNamedValue } from './docs.js';
import { directivesOf } from './load.js';
/**
 * Build a context from plain data.
 *
 * `componentsJson` is the *text* of vehicle_components.json rather than a
 * parsed object, because whether a number was written `4` or `4.0` changes the
 * result and `JSON.parse` throws that away.
 */
export function vehicleContext(componentsJson, parameters) {
    const document = fromJsonText(componentsJson);
    const components = document.t === 'dict' ? (document.v.get('Components') ?? document) : document;
    return { components, parameters: fromParameterMap(parameters) };
}
function scopeOf(vehicle) {
    return new Map([
        ['vehicle_components', vehicle.components],
        ['fc_parameters', vehicle.parameters]
    ]);
}
/**
 * Parameters are floats on the wire, so every computed value lands as a number.
 *
 * A string result is a *named* value -- the operator said 'Quad', not 1 -- and
 * is resolved against the parameter's documentation. Without documentation
 * there is no way to know what number was meant, so it fails rather than
 * guessing.
 */
function toNumber(parameter, value, docs) {
    switch (value.t) {
        case 'int':
        case 'float':
            if (!Number.isFinite(value.v)) {
                throw new PyError('ValueError', `${parameter}: evaluation produced ${value.v}`);
            }
            return value.v;
        case 'bool':
            return value.v ? 1 : 0;
        case 'str':
            if (!docs) {
                throw new UnresolvableValueError(parameter, value.v, 'undocumented');
            }
            return resolveNamedValue(parameter, value.v, docs);
        default:
            throw new PyError('TypeError', `parameter value must be numeric, got ${value.t}`);
    }
}
function describe(error) {
    if (error instanceof PyError)
        return { error: error.message, errorType: error.pyType };
    if (error instanceof UnresolvableValueError)
        return { error: error.message, errorType: error.name };
    return { error: error instanceof Error ? error.message : String(error), errorType: 'Error' };
}
/** Evaluate a directive's guard. A directive with no guard always applies. */
function guardPasses(directive, scope) {
    if (directive.if === undefined)
        return { applies: true };
    const result = evaluateIn(directive.if, scope);
    // Python truthiness, so a guard yielding 0 or '' also declines.
    const applies = result.t === 'bool'
        ? result.v
        : result.t === 'int' || result.t === 'float'
            ? result.v !== 0
            : result.t === 'str'
                ? result.v.length > 0
                : result.t === 'none'
                    ? false
                    : true;
    return { applies, guard: directive.if };
}
export function applyStep(step, vehicle, options = {}) {
    const scope = scopeOf(vehicle);
    const changes = [];
    const deletions = [];
    const skipped = [];
    const failures = [];
    for (const { group, parameter, directive } of directivesOf(step)) {
        let applies;
        try {
            const verdict = guardPasses(directive, scope);
            applies = verdict.applies;
            if (!applies) {
                skipped.push({ parameter, group, guard: verdict.guard });
                continue;
            }
        }
        catch (error) {
            failures.push({ parameter, group, expression: directive.if, ...describe(error) });
            continue;
        }
        if (group === 'delete_parameters') {
            deletions.push(parameter);
            continue;
        }
        const raw = directive['New Value'];
        if (raw === undefined) {
            // add_parameters may take its value from the step's own .param file
            // rather than stating one; there is nothing to compute.
            continue;
        }
        if (typeof raw === 'number') {
            changes.push(directive['Change Reason'] === undefined
                ? { parameter, value: raw, group, source: 'literal' }
                : { parameter, value: raw, group, reason: directive['Change Reason'], source: 'literal' });
            continue;
        }
        try {
            const value = toNumber(parameter, evaluateIn(raw, scope), options.docs);
            changes.push(directive['Change Reason'] === undefined
                ? { parameter, value, group, source: 'expression' }
                : { parameter, value, group, reason: directive['Change Reason'], source: 'expression' });
        }
        catch (error) {
            failures.push({ parameter, group, expression: raw, ...describe(error) });
        }
    }
    return { changes, deletions, skipped, failures };
}
export { evaluate };
