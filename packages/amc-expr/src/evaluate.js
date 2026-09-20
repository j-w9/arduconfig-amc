/**
 * Evaluator for the parsed expressions, matching CPython's arithmetic.
 *
 * The places this differs from the obvious JavaScript are the interesting ones,
 * and each is commented: banker's rounding, truncation toward zero, floor
 * division and modulo on negatives, and `and`/`or` returning an operand rather
 * than a boolean.
 */
import { parse } from './parser.js';
import { NONE, PyError, bool, float, fromJson, int, isNumeric, str, truthy, typeName } from './values.js';
/**
 * Python's `round()`: half-to-even, applied to the double's *exact* value.
 *
 * Both halves of that matter. Math.round is half-up, so it disagrees on ties
 * (Python's round(2.5) is 2). And the obvious `value * 10 ** digits` introduces
 * error that invents ties which are not there -- round(5.55, 1) is 5.5 in
 * Python, because 5.55 is really 5.549999..., but scaling it lands on 55.5 and
 * rounds away to 5.6. So the exact binary value is reconstructed as a rational
 * and rounded with integer arithmetic.
 */
function exactRational(value) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, Math.abs(value));
    const bits = view.getBigUint64(0);
    const rawExponent = Number((bits >> 52n) & 0x7ffn);
    const rawMantissa = bits & 0xfffffffffffffn;
    // Subnormals have no implicit leading one and sit one exponent higher.
    const mantissa = rawExponent === 0 ? rawMantissa : rawMantissa | 0x10000000000000n;
    const exponent = (rawExponent === 0 ? 1 : rawExponent) - 1075;
    return exponent >= 0
        ? { num: mantissa << BigInt(exponent), den: 1n }
        : { num: mantissa, den: 1n << BigInt(-exponent) };
}
function pyRound(value, digits = 0) {
    if (!Number.isFinite(value))
        return value;
    const negative = value < 0;
    let { num, den } = exactRational(value);
    if (digits >= 0)
        num *= 10n ** BigInt(digits);
    else
        den *= 10n ** BigInt(-digits);
    let quotient = num / den;
    const remainder = num % den;
    const twice = remainder * 2n;
    if (twice > den || (twice === den && quotient % 2n === 1n))
        quotient += 1n;
    const scale = 10 ** Math.abs(digits);
    const magnitude = digits >= 0 ? Number(quotient) / scale : Number(quotient) * scale;
    return negative ? -magnitude : magnitude;
}
/** `int()` truncates toward zero; Math.floor would walk negatives the wrong way. */
function pyTrunc(value) {
    return value < 0 ? Math.ceil(value) : Math.floor(value);
}
function numeric(value, context) {
    if (isNumeric(value))
        return value.v;
    if (value.t === 'bool')
        return value.v ? 1 : 0;
    throw new PyError('TypeError', `${context}: expected a number, got ${typeName(value)}`);
}
/** An int result only survives if both operands were ints. */
function bothInt(left, right) {
    const intish = (v) => v.t === 'int' || v.t === 'bool';
    return intish(left) && intish(right);
}
/** Compare release versions the way packaging.Version does, segment by segment. */
function versionParts(text) {
    const core = text.trim().replace(/^v/i, '').split(/[-+]/)[0];
    return core.split('.').map((part) => {
        const digits = /^\d+/.exec(part);
        return digits ? Number(digits[0]) : 0;
    });
}
function compareVersions(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0)
            return diff < 0 ? -1 : 1;
    }
    return 0;
}
function equal(left, right) {
    if (left.t === 'version' || right.t === 'version') {
        if (left.t !== 'version' || right.t !== 'version')
            return false;
        return compareVersions(left.v, right.v) === 0;
    }
    if (isNumeric(left) || left.t === 'bool') {
        if (!(isNumeric(right) || right.t === 'bool'))
            return false;
        return numeric(left, '==') === numeric(right, '==');
    }
    if (left.t === 'str' && right.t === 'str')
        return left.v === right.v;
    if (left.t === 'none' && right.t === 'none')
        return true;
    if (left.t === 'list' && right.t === 'list') {
        return left.v.length === right.v.length && left.v.every((item, i) => equal(item, right.v[i]));
    }
    if (left.t === 'dict' && right.t === 'dict') {
        if (left.v.size !== right.v.size)
            return false;
        for (const [key, value] of left.v) {
            const other = right.v.get(key);
            if (other === undefined || !equal(value, other))
                return false;
        }
        return true;
    }
    return false;
}
function ordered(left, right, op) {
    let sign;
    if (left.t === 'version' && right.t === 'version') {
        sign = compareVersions(left.v, right.v);
    }
    else if (left.t === 'str' && right.t === 'str') {
        sign = left.v < right.v ? -1 : left.v > right.v ? 1 : 0;
    }
    else if ((isNumeric(left) || left.t === 'bool') && (isNumeric(right) || right.t === 'bool')) {
        const a = numeric(left, op);
        const b = numeric(right, op);
        sign = a < b ? -1 : a > b ? 1 : 0;
    }
    else {
        throw new PyError('TypeError', `'${op}' not supported between ${typeName(left)} and ${typeName(right)}`);
    }
    switch (op) {
        case '<':
            return sign < 0;
        case '<=':
            return sign <= 0;
        case '>':
            return sign > 0;
        default:
            return sign >= 0;
    }
}
/** `in` means key lookup on a dict, substring on a string, membership on a list. */
function contains(needle, haystack) {
    switch (haystack.t) {
        case 'dict': {
            if (needle.t !== 'str')
                return false;
            return haystack.v.has(needle.v);
        }
        case 'list':
            return haystack.v.some((item) => equal(item, needle));
        case 'str': {
            if (needle.t !== 'str') {
                throw new PyError('TypeError', `'in <string>' requires string as left operand, not ${typeName(needle)}`);
            }
            return haystack.v.includes(needle.v);
        }
        default:
            throw new PyError('TypeError', `argument of type '${typeName(haystack)}' is not iterable`);
    }
}
function callFunction(name, args) {
    const arity = (n) => {
        if (args.length !== n)
            throw new PyError('TypeError', `${name}() takes ${n} argument(s), got ${args.length}`);
    };
    switch (name) {
        case 'max':
        case 'min': {
            // max(iterable) and max(a, b, ...) are both spelled the same way.
            const only = args.length === 1 ? args[0] : undefined;
            const pool = only?.t === 'list' ? [...only.v] : args;
            if (pool.length === 0)
                throw new PyError('ValueError', `${name}() arg is an empty sequence`);
            let best = pool[0];
            for (const candidate of pool.slice(1)) {
                const wins = name === 'max' ? ordered(candidate, best, '>') : ordered(candidate, best, '<');
                if (wins)
                    best = candidate;
            }
            return best;
        }
        case 'round': {
            if (args.length < 1 || args.length > 2) {
                throw new PyError('TypeError', `round() takes 1 or 2 arguments, got ${args.length}`);
            }
            const target = args[0];
            const value = numeric(target, 'round');
            // One-argument round() always returns an int; with a digit count it hands
            // back the type it was given, so round(27000, -2) stays an int.
            if (args.length === 1)
                return int(pyRound(value));
            const rounded = pyRound(value, numeric(args[1], 'round'));
            return target.t === 'float' ? float(rounded) : int(rounded);
        }
        case 'abs': {
            arity(1);
            const value = args[0];
            const magnitude = Math.abs(numeric(value, 'abs'));
            return value.t === 'float' ? float(magnitude) : int(magnitude);
        }
        case 'len': {
            arity(1);
            const value = args[0];
            if (value.t === 'str')
                return int(value.v.length);
            if (value.t === 'list')
                return int(value.v.length);
            if (value.t === 'dict')
                return int(value.v.size);
            throw new PyError('TypeError', `object of type '${typeName(value)}' has no len()`);
        }
        case 'log': {
            if (args.length < 1 || args.length > 2) {
                throw new PyError('TypeError', `log() takes 1 or 2 arguments, got ${args.length}`);
            }
            const value = numeric(args[0], 'log');
            if (value === 0)
                throw new PyError('ValueError', 'math domain error');
            if (value < 0)
                throw new PyError('ValueError', 'math domain error');
            if (args.length === 2)
                return float(Math.log(value) / Math.log(numeric(args[1], 'log')));
            return float(Math.log(value));
        }
        case 'int': {
            arity(1);
            const value = args[0];
            if (value.t === 'str') {
                const text = value.v.trim();
                if (!/^[+-]?\d+$/.test(text)) {
                    throw new PyError('ValueError', `invalid literal for int() with base 10: '${value.v}'`);
                }
                return int(Number(text));
            }
            return int(pyTrunc(numeric(value, 'int')));
        }
        case 'Version': {
            arity(1);
            const value = args[0];
            if (value.t !== 'str')
                throw new PyError('TypeError', 'Version() expects a string');
            if (!/^\s*v?\d+(\.\d+)*/.test(value.v)) {
                throw new PyError('ValueError', `Invalid version: '${value.v}'`);
            }
            return { t: 'version', v: value.v };
        }
        default:
            throw new PyError('NameError', `name '${name}' is not defined`);
    }
}
function evalNode(node, scope) {
    switch (node.kind) {
        case 'num':
            return node.isInt ? int(node.value) : float(node.value);
        case 'str':
            return str(node.value);
        case 'bool':
            return bool(node.value);
        case 'none':
            return NONE;
        case 'name': {
            const value = scope.get(node.id);
            if (value === undefined)
                throw new PyError('NameError', `name '${node.id}' is not defined`);
            return value;
        }
        case 'list':
            return { t: 'list', v: node.items.map((item) => evalNode(item, scope)) };
        case 'index': {
            const target = evalNode(node.target, scope);
            const key = evalNode(node.key, scope);
            if (target.t === 'dict') {
                if (key.t !== 'str')
                    throw new PyError('KeyError', String(key.t === 'none' ? 'None' : key.v));
                const found = target.v.get(key.v);
                if (found === undefined)
                    throw new PyError('KeyError', `'${key.v}'`);
                return found;
            }
            if (target.t === 'list' || target.t === 'str') {
                const raw = numeric(key, 'index');
                const length = target.t === 'list' ? target.v.length : target.v.length;
                const at = raw < 0 ? length + raw : raw;
                if (!Number.isInteger(at) || at < 0 || at >= length) {
                    throw new PyError('IndexError', `${target.t} index out of range`);
                }
                return target.t === 'list' ? target.v[at] : str(target.v[at]);
            }
            throw new PyError('TypeError', `'${typeName(target)}' object is not subscriptable`);
        }
        case 'call': {
            if (node.callee.kind !== 'name')
                throw new PyError('TypeError', 'only named functions may be called');
            return callFunction(node.callee.id, node.args.map((arg) => evalNode(arg, scope)));
        }
        case 'method': {
            const target = evalNode(node.target, scope);
            const args = node.args.map((arg) => evalNode(arg, scope));
            if (node.name !== 'split') {
                throw new PyError('TypeError', `'${typeName(target)}' object has no attribute '${node.name}'`);
            }
            if (target.t !== 'str')
                throw new PyError('TypeError', `'${typeName(target)}' object has no attribute 'split'`);
            // Bare split() splits on runs of whitespace and drops empties, which is
            // not what String.prototype.split(' ') does.
            if (args.length === 0) {
                const parts = target.v.split(/\s+/).filter((part) => part.length > 0);
                return { t: 'list', v: parts.map(str) };
            }
            const separator = args[0];
            if (separator.t !== 'str')
                throw new PyError('TypeError', 'split() expects a string separator');
            if (separator.v === '')
                throw new PyError('ValueError', 'empty separator');
            return { t: 'list', v: target.v.split(separator.v).map(str) };
        }
        case 'unary': {
            if (node.op === 'not')
                return bool(!truthy(evalNode(node.operand, scope)));
            const operand = evalNode(node.operand, scope);
            const value = numeric(operand, node.op);
            const signed = node.op === '-' ? -value : value;
            return operand.t === 'float' ? float(signed) : int(signed);
        }
        case 'bool-op': {
            // Python yields the deciding operand, not a coerced boolean.
            const left = evalNode(node.left, scope);
            if (node.op === 'and')
                return truthy(left) ? evalNode(node.right, scope) : left;
            return truthy(left) ? left : evalNode(node.right, scope);
        }
        case 'ternary':
            return truthy(evalNode(node.cond, scope))
                ? evalNode(node.then, scope)
                : evalNode(node.otherwise, scope);
        case 'compare': {
            const left = evalNode(node.left, scope);
            const right = evalNode(node.right, scope);
            switch (node.op) {
                case '==':
                    return bool(equal(left, right));
                case '!=':
                    return bool(!equal(left, right));
                case 'in':
                    return bool(contains(left, right));
                case 'not in':
                    return bool(!contains(left, right));
                default:
                    return bool(ordered(left, right, node.op));
            }
        }
        case 'binary': {
            const left = evalNode(node.left, scope);
            const right = evalNode(node.right, scope);
            // `+` is concatenation for strings and lists before it is arithmetic.
            if (node.op === '+') {
                if (left.t === 'str' && right.t === 'str')
                    return str(left.v + right.v);
                if (left.t === 'list' && right.t === 'list')
                    return { t: 'list', v: [...left.v, ...right.v] };
            }
            const a = numeric(left, node.op);
            const b = numeric(right, node.op);
            const keepInt = bothInt(left, right);
            const wrap = (value) => (keepInt ? int(value) : float(value));
            switch (node.op) {
                case '+':
                    return wrap(a + b);
                case '-':
                    return wrap(a - b);
                case '*':
                    return wrap(a * b);
                case '/':
                    // True division is always float, and never silently yields Infinity.
                    if (b === 0)
                        throw new PyError('ZeroDivisionError', 'division by zero');
                    return float(a / b);
                case '//':
                    if (b === 0)
                        throw new PyError('ZeroDivisionError', 'integer division or modulo by zero');
                    return wrap(Math.floor(a / b));
                case '%': {
                    if (b === 0)
                        throw new PyError('ZeroDivisionError', 'integer division or modulo by zero');
                    // Python's modulo takes the sign of the divisor; JS's takes the dividend's.
                    return wrap(((a % b) + b) % b);
                }
                case '**': {
                    // JS yields Infinity here; Python calls it a division by zero.
                    if (a === 0 && b < 0) {
                        throw new PyError('ZeroDivisionError', '0.0 cannot be raised to a negative power');
                    }
                    const power = a ** b;
                    // A negative exponent demotes to float even when both sides are ints.
                    return keepInt && b >= 0 ? int(power) : float(power);
                }
                case '<<':
                case '>>': {
                    if (!keepInt || !Number.isInteger(a) || !Number.isInteger(b)) {
                        throw new PyError('TypeError', `unsupported operand type(s) for ${node.op}`);
                    }
                    if (b < 0)
                        throw new PyError('ValueError', 'negative shift count');
                    // Exact beyond 32 bits, where JS's << would wrap.
                    return int(node.op === '<<' ? a * 2 ** b : Math.floor(a / 2 ** b));
                }
            }
        }
    }
}
/**
 * Parse and evaluate one configuration-step expression.
 *
 * `scope` takes plain JSON -- typically `{ vehicle_components, fc_parameters }`
 * -- and is wrapped into the Python value model on the way in. Prefer
 * `evaluateIn` when the values were loaded with `fromJsonText` or
 * `fromParameterMap`, which know whether a number is an int or a float.
 */
export function evaluate(expression, scope) {
    const names = new Map();
    for (const [key, value] of Object.entries(scope))
        names.set(key, fromJson(value));
    return evaluateIn(parse(expression), names);
}
/** Evaluate an already-parsed expression against already-typed values. */
export function evaluateIn(expression, scope) {
    const node = typeof expression === 'string' ? parse(expression) : expression;
    return evalNode(node, new Map(scope));
}
