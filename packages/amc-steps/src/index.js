/**
 * AMC's guided configuration sequence, as data.
 *
 * The step files are vendored verbatim from ArduPilot Methodic Configurator
 * (see steps/PROVENANCE.json for the pinned commit); this package types them
 * and walks them. Evaluating the expressions they contain is
 * `@arduconfig/amc-expr`.
 */
export * from './types.js';
export { UnresolvableValueError, parameterDocsFrom, resolveNamedValue } from './docs.js';
export { applyStep, vehicleContext } from './run.js';
export { missingComponents, readComponentPath, requiredComponents } from './components.js';
export { DIRECTIVE_GROUPS, VALUED_GROUPS, directivesOf, expressionsOf, orderSteps, parseStepFile } from './load.js';
