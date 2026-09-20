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
export { autoImportableParameters, withinTolerance } from './autoimport.js'
export { type RenamePlan, connectionRenames, planConnectionRenames } from './rename.js'
export {
  ID_PARAMETER_NAMES,
  type ConfigurationSummary,
  type SummaryCategory,
  type SummaryEntry,
  summarize
} from './summary.js'
export { componentOptionSources, optionsForField } from './options.js'
export {
  type VehicleFile,
  type VehicleFilesOptions,
  defaultsFile,
  vehicleFiles
} from './vehicle-files.js'
export {
  type ParamLine,
  formatParamValue,
  linesFromEntries,
  writeParamFile
} from './param-file-writer.js'
export {
  MANUAL_OVERRIDE_PREFIX,
  type ParamEntry,
  parameterValues,
  parseParamFile
} from './param-file.js'
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
  type OrderedPhase,
  directivesOf,
  expressionsOf,
  milestonePhases,
  orderSteps,
  orderedPhases,
  stepNumber,
  parseStepFile
} from './load.js'
export {
  type ProjectFile,
  type ProjectRename,
  type ReadStepFile,
  type VehicleProject,
  readVehicleProject
} from './read-project.js'
export { type ZipEntry, buildZip } from './zip.js'
export {
  type ThreadOptions,
  type ThreadedRun,
  type ThreadedStep,
  runThreaded
} from './thread.js'
export {
  type ConnectionPairings,
  connectionGroupOf,
  orderByPairing,
  protocolsForConnection
} from './pairings.js'
export type { ConnectionEntry, ConnectionTables } from './connection-tables.js'
export {
  type DerivedComponent,
  type FirmwareKind,
  type ImportOptions,
  type ImportResult,
  importComponentsFromParameters
} from './import-components.js'
export {
  type LogMessageStatus,
  type StepLogCheck,
  checkStepLogMessages,
  countWithVariants
} from './log-messages.js'
