/**
 * A TypeScript port of ArduPilot Methodic Configurator's safe expression
 * evaluator (data_model_safe_evaluator.py), so the guided configuration
 * sequence can run in the browser with no Python alongside it.
 *
 * Checked against upstream by tests/expression-parity.test.mjs, which replays
 * every expression in the step files across every vendored vehicle template.
 */

export { evaluate, evaluateIn, type EvalScope } from './evaluate.js'
export { fromJsonText, fromParameterMap } from './json.js'
export { parse, type Node } from './parser.js'
export { tokenize, type Token } from './lexer.js'
export {
  PyError,
  type PyErrorName,
  type PyValue,
  fromJson,
  toJs,
  truthy,
  typeName
} from './values.js'
