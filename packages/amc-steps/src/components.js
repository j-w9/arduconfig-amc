/**
 * What the sequence needs to know about the vehicle.
 *
 * `vehicle_components` is AMC's record of the hardware the operator declares --
 * props, ESC, battery, flight controller -- and it drives most of the
 * expressions in the step files. Rather than hard-coding which fields matter,
 * the required set is derived from the step files themselves by walking the
 * parsed expressions, so it stays right as upstream adds and removes steps.
 */
import { parse } from '@arduconfig/amc-expr';
import { expressionsOf } from './load.js';
/**
 * Walk a parsed expression for index chains rooted at a given name.
 *
 * Only constant string keys are collected: a computed key cannot be known
 * before the vehicle is, and none of the step files use one.
 */
function collectPaths(node, root, into) {
    const chain = (current) => {
        if (current.kind === 'name')
            return current.id === root ? [] : undefined;
        if (current.kind !== 'index')
            return undefined;
        const prefix = chain(current.target);
        if (prefix === undefined)
            return undefined;
        if (current.key.kind !== 'str')
            return undefined;
        return [...prefix, current.key.value];
    };
    const visit = (current) => {
        const path = chain(current);
        if (path !== undefined) {
            if (path.length > 0)
                into(path);
            // A chain's own segments are indexes too; no need to descend into them.
            return;
        }
        switch (current.kind) {
            case 'index':
                visit(current.target);
                visit(current.key);
                break;
            case 'call':
                visit(current.callee);
                current.args.forEach(visit);
                break;
            case 'method':
                visit(current.target);
                current.args.forEach(visit);
                break;
            case 'list':
                current.items.forEach(visit);
                break;
            case 'unary':
                visit(current.operand);
                break;
            case 'binary':
            case 'bool-op':
            case 'compare':
                visit(current.left);
                visit(current.right);
                break;
            case 'ternary':
                visit(current.cond);
                visit(current.then);
                visit(current.otherwise);
                break;
            default:
                break;
        }
    };
    visit(node);
}
/**
 * Every component field the given steps read, most-used first.
 *
 * This is the list of things the operator has to tell us before the sequence
 * can compute anything -- which makes it the specification for the component
 * editor UI, rather than a guess at one.
 */
export function requiredComponents(steps) {
    const counts = new Map();
    const seen = new Set();
    for (const step of steps) {
        for (const expression of expressionsOf(step)) {
            // One expression naming a field twice still only requires it once.
            if (seen.has(expression))
                continue;
            seen.add(expression);
            collectPaths(parse(expression), 'vehicle_components', (path) => {
                const key = path.join('\u0000');
                const existing = counts.get(key);
                if (existing)
                    existing.uses += 1;
                else
                    counts.set(key, { path, uses: 1 });
            });
        }
    }
    return [...counts.values()]
        .map(({ path, uses }) => ({ path, uses }))
        .sort((a, b) => b.uses - a.uses || a.path.join('.').localeCompare(b.path.join('.')));
}
/** Read a path out of a components document, or undefined if any segment is absent. */
export function readComponentPath(components, path) {
    let current = components;
    for (const segment of path) {
        if (current === null || typeof current !== 'object' || Array.isArray(current))
            return undefined;
        current = current[segment];
        if (current === undefined)
            return undefined;
    }
    return current;
}
/**
 * Which required fields this vehicle has not declared.
 *
 * Not every field is needed by every vehicle -- a guard may mean a step never
 * reads it -- so this reports what is absent rather than rejecting the
 * document. It is what tells the UI which questions are still unanswered.
 */
export function missingComponents(components, required) {
    return required.filter(({ path }) => readComponentPath(components, path) === undefined);
}
