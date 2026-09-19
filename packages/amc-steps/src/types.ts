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
  readonly why?: string
  readonly why_now?: string
  readonly blog_text?: string
  readonly blog_url?: string
  readonly wiki_text?: string
  readonly wiki_url?: string
  readonly external_tool_text?: string
  readonly external_tool_url?: string
  readonly mandatory_text?: string
  readonly instructions_popup?: string
  readonly component?: string
  readonly auto_changed_by?: string
  readonly jump_possible?: Readonly<Record<string, string>>
  readonly download_file?: unknown
  readonly upload_file?: unknown
  readonly rename_connection?: string
  readonly old_filenames?: readonly string[]
  readonly related_bin_messages?: readonly string[]
  readonly plugin?: string
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
