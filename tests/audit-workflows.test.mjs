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

test('every answer says where, and says it in words', () => {
  for (const [name, answer] of Object.entries(ACCOUNTED_FOR)) {
    assert.ok(
      ['ours', 'elsewhere', 'declined'].includes(answer.verdict),
      `${name} has no recognised verdict`
    )
    assert.ok(answer.where.length > 20, `${name} is accounted for without saying how`)
  }
})
