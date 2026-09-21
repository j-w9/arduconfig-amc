// Every workflow AMC has, accounted for.
//
// "Do we match AMC?" answered from memory was wrong three times out of three,
// each time about something whole rather than something subtle -- a resume
// point, a stream-rate rename. This audit takes the question away from memory:
// it scrapes the `*_workflow` methods out of AMC's source and fails on any one
// this fork has not made a decision about.
//
// A decision is not the same as an implementation. Some of these are answered
// elsewhere in ArduConfigurator, some are Tk plumbing with no counterpart in a
// browser, and one is deliberately declined. What the audit refuses to allow is
// a workflow nobody has looked at.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SOURCE = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/', import.meta.url)
)

/**
 * What became of each of AMC's workflows.
 *
 * `where` is prose on purpose. The point of the audit is that a human has
 * answered for the workflow, and a symbol name would let that answer rot into
 * something nobody rereads.
 */
const ACCOUNTED_FOR = {
  // Implemented in this fork.
  upload_selected_params_workflow: { verdict: 'ours', where: "a step's Write, through the app's verified write and read-back" },
  upload_external_params_workflow: { verdict: 'ours', where: 'external-params.ts and the tab\'s "A parameter file from somewhere else" panel' },
  upload_parameters_that_require_reset_workflow: { verdict: 'ours', where: 'reboot.ts — rebootWaitSeconds, and the step\'s reboot-and-reconnect' },
  handle_write_changes_workflow: { verdict: 'ours', where: 'vehicle-files.ts writes the directory; the download button runs it' },
  write_summary_files_workflow: { verdict: 'ours', where: 'summaryFiles() — all six, not the one this fork used to write' },
  _write_single_summary_file_workflow: { verdict: 'ours', where: 'summaryFiles(), as one of the six' },
  _write_zip_file_workflow: { verdict: 'ours', where: 'zip.ts, deterministic and checked against system unzip' },
  create_forum_help_zip_workflow: { verdict: 'ours', where: 'the same zip writer over the same file set' },
  handle_param_file_change_workflow: { verdict: 'ours', where: 'read-project.ts, including old_filenames and @manual_override' },
  handle_copy_fc_values_workflow: { verdict: 'ours', where: 'the step\'s "Take N from the vehicle"' },
  handle_imu_temperature_calibration_workflow: { verdict: 'ours', where: 'tempcal.ts and tempcal-plot.ts, fitted against NumPy' },
  download_last_flight_log_workflow: { verdict: 'ours', where: "the tab's log fetch, off the vehicle rather than via another tab" },
  reset_and_reconnect_workflow: { verdict: 'ours', where: 'onRebootAndReconnect — reboot, wait out the boot delay, reconnect' },
  should_upload_file_to_fc_workflow: { verdict: 'ours', where: 'onInstallFile, for the two steps that need a Lua applet' },
  _should_download_file_from_url_workflow: { verdict: 'ours', where: 'the same install path, which fetches before it writes' },
  _handle_file_jump_workflow: { verdict: 'ours', where: 'jumpToStep, and nextRequiredStep for the optional ones' },

  // Answered by ArduConfigurator itself, which this tab points at rather than
  // reimplementing. A second implementation of a destructive command is worse
  // than a link to the one that already has the confirmation and the armed check.
  reset_all_parameters_to_default: {
    verdict: 'elsewhere',
    where: "runtime.resetParametersToDefaults(), on the Firmware and Presets tabs; the AMC panel links to it"
  },

  // No counterpart here, and none wanted.
  display_workflow_explanation: { verdict: 'declined', where: "AMC's per-step explanation window; this tab shows the text inline instead" },
  workflow_image_filepath: { verdict: 'declined', where: "a path helper for AMC's step images, not a workflow" }
}

/**
 * The public surface of the two modules that implement the method itself.
 *
 * `*_workflow` was never the whole of it. `reset_all_parameters_to_default`
 * had to be named by hand because it does not carry the suffix, and
 * `add_parameter_to_current_file` -- an editing capability this fork did not
 * have at all -- was invisible for the same reason. Naming the methods to look
 * at was choosing what could be found.
 */
const BEHAVIOUR_MODULES = readdirSync(SOURCE).filter(
  (name) =>
    name.endsWith('.py') &&
    // AMC's method, not its transport. ArduConfigurator has its own MAVLink,
    // MAVFTP, bootloader and serial stacks, already exercised against real
    // hardware; comparing those method-by-method would be comparing two
    // unrelated implementations of the same protocol.
    (/^(data_model_|backend_filesystem)/.test(name) ||
      ['tempcal_imu.py', 'annotate_params.py', 'extract_param_defaults.py', 'battery_cell_voltages.py'].includes(
        name
      ))
)

function publicBehaviour() {
  const found = new Set()
  for (const filename of BEHAVIOUR_MODULES) {
    const text = readFileSync(SOURCE + filename, 'utf8')
    // Class methods and module-level functions alike. Matching only indented
    // definitions missed every free function -- safe_evaluate, polyfit,
    // validate_param_name -- which is most of what the smaller modules are.
    for (const match of text.matchAll(/^(?:\s{4})?def ([a-z]\w*)\s*\(/gm)) {
      found.add(match[1])
    }
  }
  return found
}

/** The `*_workflow` methods AMC defines, plus the reset it offers beside them. */
function amcWorkflows() {
  const found = new Set()
  for (const filename of readdirSync(SOURCE)) {
    if (!filename.endsWith('.py')) continue
    const text = readFileSync(SOURCE + filename, 'utf8')
    for (const match of text.matchAll(/^\s*def (\w*workflow\w*|reset_all_parameters_to_default)\s*\(/gm)) {
      found.add(match[1])
    }
  }
  return found
}

test('the scrape finds AMC\'s workflows at all', () => {
  // Without this the audit passes by finding nothing, which is the failure
  // mode that matters: a vendor reorganisation would silently turn it into a
  // test that asserts an empty set against an empty set.
  const workflows = amcWorkflows()
  assert.ok(workflows.size >= 15, `only found ${workflows.size} workflows in AMC's source`)
  assert.ok(workflows.has('upload_selected_params_workflow'))
})

test('every workflow AMC has, this fork has answered for', () => {
  const unanswered = [...amcWorkflows()].filter((name) => !(name in ACCOUNTED_FOR)).sort()
  assert.deepEqual(
    unanswered,
    [],
    `AMC has workflows this fork has not made a decision about: ${unanswered.join(', ')}`
  )
})

test('nothing is answered for that AMC no longer has', () => {
  // The other direction. An entry for a workflow AMC has dropped is a claim
  // about a vendor that has moved on, and reads as coverage that is not there.
  const workflows = amcWorkflows()
  const stale = Object.keys(ACCOUNTED_FOR).filter((name) => !workflows.has(name)).sort()
  assert.deepEqual(stale, [], `answers for workflows AMC no longer has: ${stale.join(', ')}`)
})

/**
 * The rest of that surface, beyond the workflows.
 *
 * Shorter entries than the workflow map above: most are accessors over data
 * this tab already holds, and spelling out a sentence for each would be
 * ceremony rather than accounting. What the list is for is that a method
 * appearing upstream has to be looked at by somebody.
 */
const BEHAVIOUR_ACCOUNTED_FOR = {
  // Things this tab does.
  connected_vehicle_type: 'the firmware the link reports, used to pick a sequence',
  is_fc_connected: 'the connected prop',
  fc_parameters: 'the live parameter map',
  ensure_upload_preconditions: "the app's own draft validation, which every write goes through",
  update_parameter_value: 'staging into the draft bar',
  update_parameter_object: 'the same path',
  get_different_parameters: "each step's changes, compared against the live value",
  get_possible_add_param_names: 'addableParameters',
  add_parameter_to_current_file: "the step's own add control",
  delete_parameter_from_current_file: 'removing one you added; the sequence\'s own values are not deletable here',
  load_external_parameter_file: 'compareExternalParams',
  parameter_files: 'the ordered sequence',
  parameter_documentation_available: "the docs prop, absent until ArduPilot's metadata loads",
  configuration_phases: 'the phase navigation',
  open_documentation_in_browser: "each step's reference links",
  get_documentation_text_and_url: 'the same links',
  get_why_why_now_tooltip: "the step's why and why-now text, shown inline rather than on hover",
  parse_mandatory_level_percentage: 'mandatoryPercent',
  is_configuration_step_optional: 'isStepOptional',
  get_next_non_optional_file: 'nextRequiredStep',
  get_previous_non_optional_file: 'previousRequiredStep',
  get_current_component: "the step's component",
  refresh_current_step_computed_parameters: 'the sequence re-runs on every change to the declaration',
  update_vehicle_components: 'the declaration form',
  save_vehicle_components: 'the form, persisted per vehicle',
  process_configuration_step: 'applyStep',
  filter_different_parameters: 'the same comparison',
  calculate_connection_rename_operations: 'planConnectionRenames',
  download_flight_controller_parameters: "the app's own parameter sync",
  is_mavftp_supported: "the app's MAVFTP support, which the packed-defaults read depends on",

  // Answered elsewhere in ArduConfigurator.
  reset_all_parameters_to_default: 'the Firmware and Presets tabs, which this tab links to',
  get_vehicle_directory: 'a directory is a download here, not a path on disk',

  // Internal to AMC's own object model, with no separate behaviour.
  parameters_as_par_dict: "a conversion between AMC's own types",
  get_parameters_as_par_dict: 'the same',
  create_ardupilot_parameter: "constructs AMC's parameter object",
  get_component_editor_deps: "wiring for AMC's component editor window",

  // Deliberately not carried across.
  add_parameters_to_current_file: 'bulk add; one at a time is the whole of the need here, and a bulk paste invites values nobody read',
  generate_bulk_add_feedback_message: 'the message that bulk add would produce',
  get_plugin: "AMC's plugin system, which this tab has no equivalent of",
  create_plugin_data_model: 'the same',
  get_instructions_popup: "AMC's first-run usage popups; this tab explains itself inline",
  should_display_bitmask_parameter_editor_usage: 'one of those popups',
  get_documentation_frame_title: "a title for AMC's documentation pane",
  get_fc_banner_text: "the banner AMC's own window shows; the app has its own connection status",
  get_sorted_phases_with_end_and_weight: "widths for AMC's phase bar; the phase navigation here is a list, not a proportional bar",
  get_last_configuration_step_number: "an index into AMC's file list",
  get_log_analysis_context_inputs: "inputs for AMC's log analysis window; the log is read here for the calibration, the defaults and the step evidence",
  revert_vehicle_components: 'undo on the declaration form; the browser form and the stored progress already cover reopening',

  // backend_filesystem: building and reading the directory.
  read_params_from_files: 'readVehicleProject',
  rename_parameter_files: "old_filenames, resolved when a directory is read",
  compound_params: 'completeFile, which accumulates every step in order',
  export_to_param: 'writeParamFile',
  annotate_intermediate_comments_to_param_dict: 'annotateParamFile, behind the documentation toggle',
  categorize_parameters: 'summarize, and the four non-default summary files',
  zip_files: 'buildZip, deterministic and checked against system unzip',
  add_configuration_file_to_zip: 'the same writer, one entry at a time',
  zip_file_path: 'projectFilename',
  write_last_uploaded_filename: 'lastWrittenFile, which is what resuming reads',
  get_start_file: 'resumePoint, including opening past the temperature calibration on a firmware that has none',
  backup_fc_parameters_to_file: 'backupFiles',
  find_lowest_available_backup_number: 'nextBackupNumber',
  get_eval_variables: 'vehicleContext',
  calculate_derived_and_forced_param_changes: 'applyStep',
  merge_forced_or_derived_parameters: 'the same, which merges as it evaluates',
  apply_computed_changes: 'the same',
  save_vehicle_params_to_files: 'vehicleFiles, whose caller decides where bytes go',
  set_param_default_values_if_different: 'defaultsFile',
  write_param_default_values_to_file: 'the same',
  get_download_url_and_local_filename: "onInstallFile, for the two steps needing a Lua applet",
  get_upload_local_and_remote_filenames: 'the same',
  copy_template_files_to_new_vehicle_dir: "the baseline, seeded from AMC's empty template for the firmware",
  tempcal_imu_result_param_tuple: 'the calibration is written into the step that owns it',
  vehicle_configuration_file_exists: 'a directory here is a set of files in memory, not a path',
  vehicle_configuration_files_exist: 'the same',
  directory_exists: 'the same',
  new_vehicle_dir: 'the same',
  get_vehicle_directory_name: 'the same',
  get_directory_name_from_full_path: 'the same',
  getcwd: 'the same',
  zip_file_exists: 'the archive is a download, never a file on disk here',
  remove_created_files_and_vehicle_dir: 'nothing is created on disk to remove',
  re_init: 'switching sequence rebuilds the form and re-runs the steps',
  vehicle_image_filepath: 'a photo of the aircraft, which the operator supplies',
  vehicle_image_exists: 'the same',
  str_to_bool: "a parsing helper for AMC's own settings",
  get_git_commit_hash: "AMC's build metadata, about the tool rather than the vehicle",
  add_argparse_arguments: "AMC's command line, which a browser tab has no equivalent of",

  // data_model_ardupilot_parameter: AMC's per-parameter object. The app has
  // its own parameter model asking the same questions, which the draft bar and
  // the step tables are built on.
  name: "the parameter name, which every table here keys by",
  is_calibration: "ArduPilot's Calibration annotation, which the summary files separate on",
  is_readonly: "the ReadOnly annotation, likewise",
  is_bitmask: "the bitmask flag, which decides how explainValue reads a value",
  is_forced: "the forced_parameters group, shown as a tag on the step's table",
  is_derived: "the derived_parameters group, which the firmware filter acts on",
  is_multiple_choice: "a documented option list, rendered as a dropdown",
  is_manual_override: "the @manual_override marker, read and written",
  is_editable: "a forced value is not editable here either; it carries a tag saying so",
  has_fc_value: "whether the vehicle reported it, which the step's table column shows",
  fc_value_equals_default_value: "autoImportableParameters, which is exactly this comparison",
  new_value_equals_default_value: "the same comparison the other way round",
  is_different_from_fc: "the step's own changed and satisfied marking",
  is_dirty: "the app's draft bar, which owns unsaved state",
  choices_dict: "ArduPilot's documented options",
  bitmask_dict: "the same, read as bit indices",
  min_value: "the documented range a disputed value is judged against",
  max_value: "the same",
  fc_value_as_string: "formatting, which formatParamValue does",
  value_as_string: "the same",
  is_in_values_dict: "whether a value is one of the documented choices",
  tooltip_fc_value: "AMC's hover text; this tab gives the value a column of its own",
  tooltip_new_value: "the same",
  tooltip_unit: "the same",
  tooltip_change_reason: "the reason has its own column here rather than a tooltip",
  unit: "ArduPilot's documented unit",
  change_reason: "the reason a step gives for a value",
  change_reason_for_file: "the same, as written into the .param file",
  get_new_value: "the computed value",
  reset_new_value_to_file_value: "the app's own draft discard",
  get_selected_value_from_dict: "resolveNamedValue, for a value the sequence names rather than numbers",
  is_invalid_number: "the draft validation every staged value goes through",
  is_above_limit: "the documented-range check, reported as a disputed value",
  is_below_limit: "the same",
  has_unknown_bits_set: "explainValue reports the bits this firmware does not name",
  fc_value_is_above_limit: "the same checks against the vehicle's own value",
  fc_value_is_below_limit: "the same",
  fc_value_has_unknown_bits_set: "the same",
  set_fc_value: "the live parameters arrive as a prop rather than being set on an object",
  set_new_value: "staging a value into the drafts",
  set_change_reason: "a reason is fixed by the step, or typed when you add a parameter",
  set_forced_or_derived_value: "applyStep produces these rather than setting them on an object",
  set_forced_or_derived_change_reason: "the same",
  set_manual_override: "recording a decision, written with the marker",
  copy_new_value_to_file: "vehicleFiles writes the computed value",
  get_checked_keys: "which bits of a bitmask are set, in AMC's own editor",
  get_value_from_keys: "the reverse, composing a bitmask from checkboxes",

  // tempcal_imu: ArduPilot's own calibration script, ported and checked
  // against NumPy and a transcribed OnlineIMUfit.
  set_accel_poly: "the fitted coefficients, produced by fitTemperatureCalibration",
  set_gyro_poly: "the same",
  set_acoeff: "the same",
  set_gcoeff: "the same",
  set_aoffset: "the same",
  set_goffset: "the same",
  set_tmin: "the temperature range the fit covers",
  set_tmax: "the same",
  set_gyro_tcal: "the same",
  set_accel_tcal: "the same",
  set_enable: "INS_TCAL_ENABLE, written by the calibration step",
  correction: "the correction the coefficients describe",
  correction_accel: "the same",
  correction_gyro: "the same",
  param_string: "writeParamFile",
  polyfit: "polyfit, checked against NumPy over a generated corpus",
  add_accel: "imuSamplesFromLog collects these from the log",
  add_gyro: "the same",
  moving_average: "smoothing inside AMC's own fit",
  filter_array: "the same",
  filter: "the same",
  accel_at_temp: "evaluating the fit at a temperature",
  gyro_at_temp: "the same",
  constrain: "a clamp helper",
  generate_calibration_file: "the fitted parameters are written into the step that owns them",
  generate_tempcal_gyro_figures: "plotTemperatureFit, drawn as SVG per IMU",
  generate_tempcal_accel_figures: "the accelerometer fit is written into the parameters, not plotted",

  // AMC's own settings, paths, desktop integration and updater.
  normalize_path: "a directory here is a download, not a path on disk",
  normalize_for_comparison: "the same",
  validate_connection_string: "the app's own connection handling",
  application_icon_filepath: "AMC's own window chrome",
  application_logo_filepath: "the same",
  what_gets_uploaded_image_filepath: "a documentation image shipped inside AMC",
  create_new_vehicle_dir: "no directory is created on disk here",
  valid_directory_name: "projectFilename reduces whatever was typed to a safe archive name",
  store_recently_used_template_dirs: "a recent-files list, which a browser tab has no equivalent of",
  store_template_dir: "the same",
  store_recently_used_vehicle_dir: "the same",
  migrate_settings_to_latest_version: "AMC's own settings file",
  get_recent_vehicle_dirs: "the same recent-files list",
  get_templates_base_dir: "AMC's install layout",
  get_vehicles_default_dir: "the same",
  get_recently_used_dirs: "the same",
  display_usage_popup: "AMC's first-run popups; this tab explains itself inline",
  set_display_usage_popup: "the same",
  get_setting: "AMC's program settings",
  set_setting: "the same",
  motor_diagram_filepath: "AMC's motor diagrams; the app has its own motor test tab",
  motor_diagram_exists: "the same",
  get_connection_history: "the app's own connection history",
  store_connection: "the same",
  create_desktop_icon_if_needed: "AMC's desktop integration",
  setup_startup_notification: "the same",
  format_version_info: "AMC's own updater",
  check_and_update: "the same",
  check_for_software_updates: "the same",
  get_items: "AMC's recent-items list",
  store_item: "the same",
  remove_item: "the same",

  // Creating and opening a project. This tab declares and computes rather
  // than copying a directory into place.
  get_fc_default_template_dir: "baselineFor, which resolves the same empty template",
  get_current_working_directory: "no working directory in a browser tab",
  get_directory_name_from_path: "the same",
  create_new_vehicle_from_template: "declaring a vehicle and seeding from the baseline",
  create_new_vehicle_from_flight_controller: "importFromVehicle, plus the baseline",
  create_new_vehicle_from_bin_log: "a log supplies the defaults and the calibration here, not a whole project",
  open_vehicle_directory: "readProject",
  open_last_vehicle_directory: "the browser remembers the declaration, not a path",
  can_open_last_vehicle_directory: "the same",
  reset_fc_parameters_to_their_defaults: "the Firmware and Presets tabs",
  blank_component_data: "declaring nothing is the starting state here",
  infer_comp_specs_and_conn_from_fc_params: "importFromVehicle",
  use_fc_params: "the per-step Take N from the vehicle, and the step's own capture",
  is_flight_controller_connected: "the connected prop",
  get_introduction_message: "AMC's welcome window",
  get_file_parameters_list: "the ordered sequence",
  get_default_vehicle_name: "the archive is named from the declaration",
  get_vehicle_type: "the firmware the link reports",
  has_fc_parameters: "whether the vehicle reported anything",
  get_setting_metadata: "labels for AMC's new-project dialog",
  get_all_settings_metadata: "the same",
  is_setting_enabled: "the same dialog",
  get_settings_state: "the same",
  get_default_values: "the same",
  get_fc_dependent_error_message: "the same",
  validate_fc_dependent_setting: "the same",
  is_fc_conn_dependent_setting: "the same",
  is_fc_param_dependent_setting: "the same",
  validate_fc_dependent_settings: "the same",
  adjust_for_fc_connection: "the same",
  template_dir_for_bin_import: "baselineFor, matched on the same release line",
  vehicle_name_from_bin_log: "a log names no vehicle here",
  next_import_filename: "the leftovers go to fc_params_missing_or_different_*",
  extract_bin_log_data: "parametersFromLog and imuSamplesFromLog",

  // ArduPilot's own annotation and default-extraction scripts.
  create_argument_parser: "a command line, which a browser tab has no equivalent of",
  parse_arguments: "the same",
  check_max_line_length: "formatting inside AMC's annotator",
  get_xml_data: "ArduPilot's metadata, which the app generates and ships",
  load_default_param_file: "the defaults come from MAVFTP or a log here",
  remove_prefix: "a string helper",
  split_into_lines: "annotateParamFile wraps its own comment blocks",
  create_doc_dict: "parameterDocsFrom",
  format_columns: "formatting inside AMC's annotator",
  extract_parameter_name: "parseParamFile",
  missionplanner_sort: "Mission Planner's ordering; files here keep the order the step gives",
  extract_parameter_name_and_validate: "parseParamFile, which skips a line it cannot read",
  update_parameter_documentation: "annotateParamFile",
  update_parameter_documentation_file: "the same",
  print_read_only_params: "the read-only summary file",
  get_xml_dir: "ArduPilot's metadata is shipped with the app",
  get_xml_url: "the same",
  get_fallback_xml_url: "the same",
  parse_parameter_metadata: "the same",
  extract_parameter_values: "parametersFromLog, which reads the same PARM records",
  mavproxy_sort: "MAVProxy's ordering",
  sort_params: "files here keep the order the step gives",
  output_params: "writeParamFile",
  main: "an entry point for a command-line script",

  // Parameter-file semantics.
  read_param_file_lines: "parseParamFile",
  validate_param_name: "checkAddition applies ArduPilot's own rule",
  is_within_tolerance: "withinTolerance, the same atol and rtol",
  load_param_file_into_dict: "parseParamFile",
  print_out: "a command-line dump",
  append: "completeFile accumulates the steps in order",
  remove_if_value_is_similar: "the non-default summary files",
  get_missing_or_different: "unaccountedParameters, written as fc_params_missing_or_different_*",
  deep_copy: "the values here are plain data",
  differs_from: "the same comparison the step tables make",
  from_file: "parseParamFile",
  from_float_dict: "the same shape",
  from_fc_parameters: "the live parameter map",
  categorize_by_documentation: "summarize, which splits the four non-default files",
  annotate_with_comments: "annotateParamFile",

  // The declaration itself.
  get_component_data: "the declaration the form holds",
  get_component_value: "reading one field of it",
  get_all_components: "the same",
  has_components: "whether anything has been declared",
  save_to_filesystem: "buildComponentsJson, written into the archive",
  post_init: "the form is rebuilt from the sequence each time",
  import_fc_or_file_parameter: "legacyBatteryFields reads the vehicle the same way",
  update_json_structure: "buildComponentsJson seeds from the document that was opened",
  migrate_legacy_battery_fields: "legacyBatteryFields",
  set_component_value: "the declaration form, which re-seeds the cell voltages when the chemistry changes",
  init_battery_chemistry: "the chemistry field the cell voltages are judged against",
  init_possible_choices: "optionsForField and protocolsForConnection",
  correct_display_values_in_loaded_data: "values are held as the operator typed them",
  get_combobox_values_for_path: "optionsForField",
  set_configuration_template: "templateValues, when you start from a similar vehicle",
  is_new_project: "an empty declaration is the starting state",
  get_connection_type_tuples_with_labels: "the connection dropdowns",
  get_esc_connection_sub_dict: "ESC_CONNECTION_DICT, extracted",
  get_frame_class_as_protocol_dict: "FRAME_CLASS_DICT, extracted",
  get_frame_class_valid_tuple: "the same",
  get_valid_esc_telemetry_types: "escTelemetryMirror and the extracted tables",
  is_esc_telemetry_type_mirrored: "escTelemetryMirror",
  is_esc_telemetry_protocol_mirrored: "the same",
  is_valid_component_data: "validateDeclaration",
  validate_entry_limits: "validateEntryLimit, checked against AMC's own answers",
  validate_cell_voltage: "validateCellVoltage, likewise",
  recommended_cell_voltage: "cellVoltagesFor",
  validate_against_another_value: "the cross-field checks inside validateDeclaration",
  validate_all_data: "validateDeclaration",
  load_schema: "the schema is vendored; the form is built from the sequence",
  load_component_templates: "AMC's saved component templates",
  save_component_templates: "the same",
  save_component_templates_to_file: "the same",
  validate_vehicle_components: "validateDeclaration",
  load_vehicle_components_json_data: "readProject",
  save_vehicle_components_json_data: "buildComponentsJson",
  get_fc_fw_type_from_vehicle_components_json: "the declared firmware type",
  get_fc_fw_version_from_vehicle_components_json: "the declared version, which picks the baseline",
  set_fc_fw_version_and_type_in_components_json: "both are filled from the link",
  supported_vehicles: "AMC_VEHICLE_KINDS",
  get_vehicle_components_overviews: "AMC's template browser",
  get_vehicle_image_filepath: "a photo the operator supplies",
  wipe_component_info: "the Clear button",
  is_single_bit_set: "import-components, deriving a connection from a bitmask",
  is_fc_manufacturer_valid: "the same, judging a reported name",
  is_fc_model_valid: "the same",
  process_fc_parameters: "importFromVehicle",
  import_bat_voltage: "the same, for the battery",
  get_all_value_datatypes: "field types come from the documentation",
  modify_schema_for_mcu_series: "the MCU series field",
  get_component_property_description: "the schema's own field descriptions; this form shows how many expressions read each field instead",
  should_display_in_simple_mode: "AMC's simple and advanced split; this tab shows what the sequence reads",
  should_display_leaf_in_simple_mode: "the same",
  prepare_non_leaf_widget_config: "widget construction for AMC's own editor",
  prepare_leaf_widget_config: "the same",
  update_component: "the declaration form",
  derive_initial_template_name: "naming a saved component template",
  extract_component_data_from_entries: "the form holds its own values",

  // Evaluation, migration and the rest.
  compute_parameters: "applyStep",
  compute_forced_and_derived_parameters: "the same",
  compute_add_parameters: "the same",
  compute_deletions: "the same, which reports deletions",
  auto_changed_by: "the step attribute, read and shown",
  jump_possible: "the jumps a step offers",
  get_seq_tooltip_text: "the step's own why and why-now text",
  get_component: "the step's component",
  get_auto_importable_parameter_names: "autoImportableParameters",
  safe_evaluate: "@arduconfig/amc-expr, a port of the same expression language",
  migrate_vehicle_project_if_needed: "migrateProject",
  build_sr_to_mav_mapping: "streamRateRenames",
  upgrade_file_parameters_46: "upgradeParameters with the 4.6 table",
  upgrade_file_parameters_47: "the same with the 4.7 table",
  upgrade_parameters_for_firmware_version: "upgradesBetween",
  chemistries: "the chemistries the extracted table holds",
  limit_max_voltage: "the absolute_max the validation reads",
  limit_min_voltage: "the absolute_min, likewise",
  chemistry_voltage_score: "detectChemistry scores the same way",
  best_chemistry_for_voltage: "the same",
  validate_json_against_schema: "the declaration is validated by validateDeclaration",
  load_json_data: "readProject",
  save_json_data: "buildComponentsJson",
  has_unsaved_changes: "the app's draft bar owns unsaved state",
  revert_key_in_place: "the same",
  columns: "AMC's template browser",
  attributes: "the same",

  // The flight controller's identity and the firmware flasher, both of
  // which ArduConfigurator implements itself.
  reset: "the app's own flight-controller info",
  get_info: "the same",
  set_system_id_and_component_id: "the same",
  set_autopilot: "the same",
  set_type: "the same",
  set_flight_sw_version: "the same",
  set_board_version: "the same",
  set_flight_custom_version: "the same",
  set_os_custom_version: "the same",
  set_usb_vendor_and_product_ids: "the same",
  set_capabilities: "the same",
  log_flight_controller_info: "the same",
  format_display_value: "the same",
  crc: "the app's own firmware flasher",
  extf_crc: "the same",
  next_stage: "the same",
  parse_apj: "the same",
  bootloader_crc32: "the same",
  verify_expected_firmware_digest: "the same",
  check_bootloader_matches_connected_board: "the same",
  check_compatibility: "the same",
  verify_reconnected_firmware: "the same"
}

test('every public behaviour AMC has, somebody has looked at', () => {
  const unexamined = [...publicBehaviour()]
    .filter((name) => !(name in ACCOUNTED_FOR) && !(name in BEHAVIOUR_ACCOUNTED_FOR))
    .sort()
  assert.deepEqual(
    unexamined,
    [],
    `AMC's method modules have public methods nobody has looked at: ${unexamined.join(', ')}`
  )
})

test('the behaviour scrape finds a real surface', () => {
  const surface = publicBehaviour()
  assert.ok(surface.size >= 40, `only found ${surface.size} public methods`)
  assert.ok(surface.has('process_configuration_step'))
})

test('nothing is accounted for that AMC no longer has', () => {
  const surface = publicBehaviour()
  const stale = Object.keys(BEHAVIOUR_ACCOUNTED_FOR).filter((name) => !surface.has(name)).sort()
  assert.deepEqual(stale, [], `answers for methods AMC no longer has: ${stale.join(', ')}`)
})

test('every answer says where, and says it in words', () => {
  for (const [name, answer] of Object.entries(ACCOUNTED_FOR)) {
    assert.ok(
      ['ours', 'elsewhere', 'declined'].includes(answer.verdict),
      `${name} has no recognised verdict`
    )
    assert.ok(answer.where.length > 20, `${name} is accounted for without saying how`)
  }
})
