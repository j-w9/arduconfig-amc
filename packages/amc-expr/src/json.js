/**
 * JSON loading that keeps Python's int/float distinction.
 *
 * `JSON.parse` turns both `4` and `4.0` into the JS number 4, but Python's
 * json module keeps them apart -- and the step expressions multiply those
 * values into parameters that are written to a flight controller, where
 * `4 * 4 == 16` and `4.0 * 4 == 16.0` are different results. So numbers are
 * classified from their literal source text.
 */
import { float, fromJson, int } from './values.js';
/** A JSON number is a float if it was written with a point or an exponent. */
function classify(source, value) {
    return /[.eE]/.test(source) ? float(value) : int(value);
}
/**
 * Parse JSON text into the Python value model.
 *
 * Uses the reviver's source-text access (ES2025; Chrome 114+, Node 21+) where
 * available, and otherwise falls back to judging by integrality -- which loses
 * only the `4.0`-written-as-whole-number case.
 */
export function fromJsonText(text) {
    const marked = new WeakMap();
    let sawSource = false;
    const revived = JSON.parse(text, function reviver(key, value, context) {
        if (typeof value !== 'number')
            return value;
        const source = context?.source;
        if (source === undefined)
            return value;
        sawSource = true;
        const holder = this;
        let slot = marked.get(holder);
        if (!slot) {
            slot = new Map();
            marked.set(holder, slot);
        }
        slot.set(Array.isArray(holder) ? Number(key) : key, classify(source, value));
        return value;
    });
    if (!sawSource)
        return fromJson(revived);
    const rebuild = (node, holder, key) => {
        if (typeof node === 'number' && holder) {
            const tagged = marked.get(holder)?.get(key);
            if (tagged)
                return tagged;
        }
        if (Array.isArray(node))
            return { t: 'list', v: node.map((item, i) => rebuild(item, node, i)) };
        if (node !== null && typeof node === 'object') {
            const entries = new Map();
            for (const [k, v] of Object.entries(node)) {
                entries.set(k, rebuild(v, node, k));
            }
            return { t: 'dict', v: entries };
        }
        return fromJson(node);
    };
    return rebuild(revived);
}
/**
 * Build the `fc_parameters` mapping.
 *
 * Every ArduPilot parameter is a float on the wire, whatever it looks like when
 * printed, so they are all tagged float regardless of how they arrived.
 */
export function fromParameterMap(params) {
    const entries = new Map();
    for (const [name, value] of Object.entries(params))
        entries.set(name, float(value));
    return { t: 'dict', v: entries };
}
