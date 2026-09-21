// An audit of the directory's SHAPE against AMC's own source.
//
// Twice now, "does this match AMC?" has been answered from memory and been
// wrong — once about the components file's required keys, once about the
// summary files. Both were findable by reading AMC's source, so this reads
// it instead of asking me.
//
// It is deliberately mechanical: the list of files AMC writes is scraped from
// AMC, not typed out here, so a file added upstream shows up as a failure
// rather than as something nobody noticed.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const vendor = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/', import.meta.url)
)

/**
 * Every literal filename AMC writes into a VEHICLE directory.
 *
 * Two things this deliberately excludes, both found by the audit crying wolf
 * on its first run:
 *
 *   - `git_hash.txt` is AMC's own build metadata, read from its INSTALL
 *     directory. It has nothing to do with a vehicle.
 *   - a bare `.pdef.xml` is the tail of `name.replace(".param", ".pdef.xml")`,
 *     a fragment rather than a filename.
 */
function amcDirectoryFiles() {
  const sources = ['backend_filesystem.py', 'data_model_parameter_editor.py']
  const found = new Set()
  for (const source of sources) {
    const text = readFileSync(vendor + source, 'utf8')
    for (const match of text.matchAll(/"([a-z0-9_.-]+\.(?:param|csv|txt|json|xml|png|jpg))"/g)) {
      const filename = match[1]
      // A fragment, not a name: nothing is written to ".pdef.xml".
      if (filename.startsWith('.')) continue
      if (filename === 'git_hash.txt') continue
      found.add(filename)
    }
  }
  return found
}

/** What we write, by name or by the shape of a generated name. */
const OURS = new Set([
  '00_default.param',
  'vehicle_components.json',
  'complete.param',
  'reusable.param',
  'non-default_read-only.param',
  'non-default_writable_calibrations.param',
  'non-default_writable_ids.param',
  'non-default_writable_non-calibrations_non-ids.param',
  'last_uploaded_filename.txt',
  'tuning_report.csv',
  // Generated names, matched by shape below rather than spelled out.
  'tempcal_gyro_imu1.svg',
  'fc_params_missing_or_different_in_the_amc_param_files_X_to_Y.param'
])

/**
 * Files AMC writes that we deliberately do not, each with its reason. A gap
 * left in here on purpose is a decision; one left out of here is a bug.
 */
const DELIBERATELY_ABSENT = new Map([
  ['apm.pdef.xml', 'ArduPilot\'s whole parameter documentation — the app ships this metadata already, and the opt-in annotation writes it into the files themselves rather than beside them'],
  ['vehicle.jpg', 'a photo of the aircraft, which the operator supplies and nothing here can generate'],
  ['tempcal_gyro.png', 'drawn as SVG instead, per IMU, and written under tempcal_gyro_imuN.svg'],
  ['tempcal_acc.png', 'the accelerometer fit is written into the parameters; only the gyro is plotted']
])

test('every file AMC writes is one we write or have decided not to', () => {
  const unexplained = []
  for (const filename of amcDirectoryFiles()) {
    // Per-step .param files are the sequence's own and are handled elsewhere.
    if (/^\d+_/.test(filename)) continue
    if (OURS.has(filename) || DELIBERATELY_ABSENT.has(filename)) continue
    unexplained.push(filename)
  }
  assert.deepEqual(
    unexplained,
    [],
    `AMC writes files this directory neither produces nor has a stated reason to skip:\n  ${unexplained.join('\n  ')}`
  )
})

test('the scrape actually found AMC\'s files, rather than nothing', () => {
  // Without this the audit above passes by finding no files at all, which is
  // exactly how a check like this rots into a no-op.
  const files = amcDirectoryFiles()
  assert.ok(files.size >= 8, `only scraped ${files.size} filenames from AMC`)
  for (const expected of ['complete.param', 'last_uploaded_filename.txt', 'tuning_report.csv']) {
    assert.ok(files.has(expected), `the scrape missed ${expected}`)
  }
})

test('nothing sits in the deliberately-absent list that we now write', () => {
  // The list is for decisions, not for stale excuses.
  for (const filename of DELIBERATELY_ABSENT.keys()) {
    assert.ok(!OURS.has(filename), `${filename} is both written and excused`)
  }
})
