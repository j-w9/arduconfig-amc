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
const BEHAVIOUR_MODULES = [
  'data_model_parameter_editor.py',
  'data_model_configuration_step.py',
  // Where the directory itself is built and read. Added after the two
  // autobackup files turned out to live here and nowhere the audit looked.
  'backend_filesystem.py'
]

function publicBehaviour() {
  const found = new Set()
  for (const filename of BEHAVIOUR_MODULES) {
    const text = readFileSync(SOURCE + filename, 'utf8')
    for (const match of text.matchAll(/^\s{4}def ([a-z]\w*)\s*\(/gm)) {
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
  add_argparse_arguments: "AMC's command line, which a browser tab has no equivalent of"
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
