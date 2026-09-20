/**
 * Types for AMC's configuration-step files.
 *
 * Mirrors configuration_steps_schema.json in the pinned submodule. Every field
 * is optional in practice -- the four vehicle files each use a different slice
 * of the vocabulary -- so the loader validates what it reads rather than
 * trusting the shape.
 */

/** A parameter the step sets, with the guard deciding whether it applies. */
export interface ParameterDirective {
  /**
   * The value to set: an expression when written as a string, and a plain
   * literal when written as a JSON number. `derived_parameters` and
   * `forced_parameters` always carry one; `add_parameters` may instead take
   * its value from the step's own .param file, and deletes never have one.
   */
  readonly 'New Value'?: string | number
  /** Operator-facing justification, shown beside the value. */
  readonly 'Change Reason'?: string
  /** Guard expression; when present and false, the directive is skipped. */
  readonly if?: string
}

export type ParameterDirectives = Readonly<Record<string, ParameterDirective>>

export interface ConfigurationStep {
  /** Values computed from the vehicle's components, editable afterwards. */
  readonly derived_parameters?: ParameterDirectives
  /** Values the operator must not change. */
  readonly forced_parameters?: ParameterDirectives
  readonly add_parameters?: ParameterDirectives
  readonly delete_parameters?: ParameterDirectives
  /** Patterns for pulling non-default values off the flight controller. */
  readonly autoimport_nondefault_regexp?: readonly string[]
  /** Why this step exists at all. */
  readonly why?: string
  /** Why it is done *here* rather than earlier or later. */
  readonly why_now?: string
  /** How much of this step is required, in AMC's own words. */
  readonly mandatory_text?: string
  readonly blog_text?: string
  readonly blog_url?: string
  readonly wiki_text?: string
  readonly wiki_url?: string
  /** A tool outside this app that the step expects you to use. */
  readonly external_tool_text?: string
  readonly external_tool_url?: string
  /** Shown before the step is worked on, not alongside it. */
  readonly instructions_popup?: InstructionsPopup
  /** The component this step configures, e.g. `Frame`. */
  readonly component?: string
  /**
   * Something outside this app sets these parameters.
   *
   * Usually another program (Mission Planner) or an event (a first flight in
   * ALT_HOLD). The text says what, and it is a precondition rather than a note.
   */
  readonly auto_changed_by?: string
  /** Steps that may be skipped to from here, each with the cost of doing so. */
  readonly jump_possible?: Readonly<Record<string, string>>
  /** A file the step fetches, typically a Lua applet. */
  readonly download_file?: DownloadFile
  /** Where that file goes on the flight controller. */
  readonly upload_file?: UploadFile
  /** Expression naming the connection this step's parameters belong to. */
  readonly rename_connection?: string
  /** What this step's file was called in older AMC versions. */
  readonly old_filenames?: readonly string[]
  /** Log messages that should appear once this step is configured. */
  readonly related_bin_messages?: Readonly<Record<string, RelatedBinMessage>>
  /** An embedded tool AMC places beside the step. */
  readonly plugin?: StepPlugin
}

/** An instruction shown before the step is worked on. */
export interface InstructionsPopup {
  readonly type: 'info' | 'warning' | string
  readonly msg: string
}

/** A log message the step's configuration should produce. */
export interface RelatedBinMessage {
  readonly name: string
  /** Absent from a log means the step did not take effect. */
  readonly required: boolean
}

export interface DownloadFile {
  readonly source_url: string
  readonly dest_local: string
}

export interface UploadFile {
  readonly source_local: string
  readonly dest_on_fc: string
}

export interface StepPlugin {
  /** The tool's name, e.g. `ahrs_orientation`. */
  readonly name: string
  readonly placement?: string
  /** Guard expression: the tool applies only to some vehicles. */
  readonly if?: string
}

/** A named run of consecutive steps, starting at the step with index `start`. */
export interface ConfigurationPhase {
  readonly description?: string
  readonly start?: number
  readonly optional?: boolean
}

export interface ConfigurationStepFile {
  readonly steps: Readonly<Record<string, ConfigurationStep>>
  readonly phases?: Readonly<Record<string, ConfigurationPhase>>
}

export type VehicleType = 'ArduCopter' | 'ArduPlane' | 'Rover' | 'Heli'

/** A step paired with its filename and position, which the file's key order fixes. */
export interface OrderedStep {
  /** The .param filename the step is keyed by, e.g. `05_board_orientation.param`. */
  readonly filename: string
  readonly index: number
  readonly step: ConfigurationStep
  /** The phase this step falls in, if the file declares phases. */
  readonly phase?: string
}
