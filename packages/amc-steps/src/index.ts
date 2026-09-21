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
  type UnaccountedOptions,
  type VehicleFile,
  type VehicleFilesOptions,
  completeFile,
  defaultsFile,
  summaryFiles,
  unaccountedParameters,
  vehicleFiles
} from './vehicle-files.js'
export {
  type AnnotationDoc,
  type AnnotationDocs,
  type ParamLine,
  annotateParamFile,
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
  type EscTelemetryMirror,
  connectionGroupOf,
  escTelemetryMirror,
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
export {
  type ParameterRename,
  type UpgradeResult,
  type UpgradeTables,
  mavlinkProtocolNumbers,
  streamRateRenames,
  upgradeParameters,
  upgradeStreamRates,
  upgradesBetween
} from './upgrade.js'
export {
  POLYNOMIAL_ORDER,
  TEMPERATURE_REFERENCE,
  type ImuCalibration,
  type ImuCalibrationInput,
  type ImuSamples,
  type TempcalOptions,
  type TempcalResult,
  fitTemperatureCalibration,
  imuSamplesFromLog,
  polyfit
} from './tempcal.js'
export {
  LAST_WRITTEN_FILENAME,
  type ResumePoint,
  lastWrittenFile,
  lastWrittenFrom,
  resumePoint
} from './resume.js'
export { type PlotOptions, plotTemperatureFit } from './tempcal-plot.js'
export { hasTuningHistory, tuningReport } from './tuning-report.js'
export { type RebootWaitInputs, changesBootDelay, rebootWaitSeconds } from './reboot.js'
export {
  OPTIONAL_THRESHOLD_PERCENT,
  isStepOptional,
  mandatoryPercent,
  nextRequiredStep,
  previousRequiredStep
} from './navigation.js'
export {
  type ExternalParamFile,
  type ExternalParamRow,
  type ExternalParamStatus,
  compareExternalParams,
  defaultSelection,
  externalParamWrites
} from './external-params.js'
export {
  ENTRY_LIMITS,
  type ComponentPath as DeclarationPath,
  type Declaration,
  type ValidateOptions,
  type ValidationError,
  cellVoltagesFor,
  declarationFrom,
  validateCellVoltage,
  validateDeclaration,
  validateEntryLimit,
  validateMotorPoles
} from './validate-components.js'
export {
  type MigratableFile,
  type Migration,
  type MigrationTables,
  formatVersionOf,
  migrateProject,
  vehicleTypeOf,
  withFormatVersion
} from './migrate.js'
export { type LogParameters, logHasDefaults, parametersFromLog } from './log-parameters.js'
export { type ExplainedValue, explainValue } from './explain-value.js'
export type { StepAdvisory } from './run.js'
export {
  COMMON_SHARE,
  type TemplateOnlyOptions,
  type TemplateOnlyParameter,
  type TemplateOnlyTable,
  answerableFromVehicle,
  templateOnlyParameters
} from './template-only.js'
export {
  FIRST_BACKUP,
  MAX_BACKUP,
  type BackupFile,
  type BackupOptions,
  backupFiles,
  nextBackupNumber
} from './backup.js'
export {
  type Addition,
  type AdditionProblem,
  type Additions,
  type AddableOptions,
  addableParameters,
  additionsFor,
  checkAddition,
  startingValue
} from './additions.js'
