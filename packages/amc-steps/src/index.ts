/**
 * AMC's guided configuration sequence, as data.
 *
 * The step files are vendored verbatim from ArduPilot Methodic Configurator
 * (see steps/PROVENANCE.json for the pinned commit); this package types them
 * and walks them. Evaluating the expressions they contain is
 * `@arduconfig/amc-expr`.
 */

export * from './types.js'
export {
  type ParameterDoc,
  type ParameterDocs,
  UnresolvableValueError,
  parameterDocsFrom,
  resolveNamedValue
} from './docs.js'
export {
  type FailedDirective,
  type ParameterChange,
  type SkippedDirective,
  type StepOutcome,
  type ApplyOptions,
  type VehicleContext,
  applyStep,
  vehicleContext
} from './run.js'
export {
  type Diagnosis,
  type DiagnosisKind,
  describePath,
  diagnose
} from './diagnose.js'
export {
  type ComponentPath,
  type ComponentRequirement,
  missingComponents,
  pathsRead,
  readComponentPath,
  requiredComponents
} from './components.js'
export {
  DIRECTIVE_GROUPS,
  VALUED_GROUPS,
  type DirectiveGroup,
  type DirectiveRef,
  directivesOf,
  expressionsOf,
  orderSteps,
  parseStepFile
} from './load.js'
