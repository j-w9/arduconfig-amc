/**
 * Tokenizer for the Python expression subset used by AMC configuration steps.
 *
 * Deliberately not a full Python lexer: the step files use literals, names,
 * indexing, one method (`.split`), the whitelisted calls, and the operators
 * enumerated below. Anything outside that raises rather than being guessed at.
 */
import { PyError } from './values.js';
/** Longest-first, so `<=` never lexes as `<` then `=`. */
const OPERATORS = [
    '**', '//', '<<', '>>', '==', '!=', '<=', '>=',
    '+', '-', '*', '/', '%', '<', '>', '(', ')', '[', ']', ',', ':', '.'
];
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'if', 'else', 'True', 'False', 'None']);
export function tokenize(source) {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i += 1;
            continue;
        }
        // Strings: single or double quoted, no f-strings, no concatenation.
        if (ch === "'" || ch === '"') {
            const start = i;
            i += 1;
            let body = '';
            while (i < source.length && source[i] !== ch) {
                if (source[i] === '\\') {
                    const next = source[i + 1];
                    body += next === 'n' ? '\n' : next === 't' ? '\t' : (next ?? '');
                    i += 2;
                    continue;
                }
                body += source[i];
                i += 1;
            }
            if (i >= source.length)
                throw new PyError('SyntaxError', `unterminated string at ${start}`);
            i += 1;
            tokens.push({ type: 'string', value: body, pos: start });
            continue;
        }
        if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
            const start = i;
            while (i < source.length && /[0-9_]/.test(source[i]))
                i += 1;
            let isInt = true;
            if (source[i] === '.' && /[0-9]/.test(source[i + 1] ?? '')) {
                isInt = false;
                i += 1;
                while (i < source.length && /[0-9_]/.test(source[i]))
                    i += 1;
            }
            if (source[i] === 'e' || source[i] === 'E') {
                const save = i;
                let j = i + 1;
                if (source[j] === '+' || source[j] === '-')
                    j += 1;
                if (/[0-9]/.test(source[j] ?? '')) {
                    isInt = false;
                    i = j;
                    while (i < source.length && /[0-9]/.test(source[i]))
                        i += 1;
                }
                else {
                    i = save;
                }
            }
            const text = source.slice(start, i).replace(/_/g, '');
            tokens.push({ type: 'number', value: text, num: Number(text), isInt, pos: start });
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            const start = i;
            while (i < source.length && /[A-Za-z0-9_]/.test(source[i]))
                i += 1;
            const word = source.slice(start, i);
            tokens.push({ type: KEYWORDS.has(word) ? 'op' : 'name', value: word, pos: start });
            continue;
        }
        const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
        if (!op)
            throw new PyError('SyntaxError', `unexpected character ${JSON.stringify(ch)} at ${i}`);
        tokens.push({ type: 'op', value: op, pos: i });
        i += op.length;
    }
    tokens.push({ type: 'eof', value: '', pos: i });
    return tokens;
}
