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
import { readFileSync, readdirSync } from 'node:fs'
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
  // Every module, not a chosen two.
  //
  // This used to read backend_filesystem.py and data_model_parameter_editor.py
  // only, and missed that AMC writes autobackup_00_before_... into the vehicle
  // directory -- the snapshot of what the aircraft held before AMC ever
  // touched it -- because that literal lives in __main__.py. Picking the
  // modules to scrape was picking the answer.
  const found = new Set()
  for (const source of readdirSync(vendor)) {
    if (!source.endsWith('.py')) continue
    const text = readFileSync(vendor + source, 'utf8')
    // The `f?` and the brace class catch f-strings: autobackup_{n:02d}.param
    // is a real filename AMC writes and a plain-literal scrape cannot see it.
    for (const match of text.matchAll(/f?"([a-z0-9_.{}:<>-]+\.(?:param|csv|txt|json|xml|png|jpg|svg))"/g)) {
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
  'autobackup_00_before_ardupilot_methodic_configurator.param',
  'autobackup_{backup_num:02d}.param',
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
  ['tempcal_acc.png', 'the accelerometer fit is written into the parameters; only the gyro is plotted'],
  // Not vehicle-directory files at all. Scraping every module rather than two
  // chosen ones is what makes the audit trustworthy, and the cost of that is
  // having to say why each of these does not belong to a vehicle.
  ['configuration_steps_schema.json', 'AMC\'s own install data — the schema its step files are validated against, not something a vehicle directory holds'],
  ['vehicle_components_schema.json', 'likewise install data; vendored under steps/ for validation rather than written per vehicle'],
  ['system_vehicle_components_template.json', 'the blank declaration AMC ships, which this tab builds from the sequence instead'],
  ['user_vehicle_components_template.json', 'a declaration the operator saved for reuse, which belongs to AMC\'s install and not to one aircraft'],
  ['settings.json', 'AMC\'s program settings, in the user config directory'],
  ['what_gets_uploaded.png', 'a documentation image shipped inside AMC'],
  ['temp_lastlog.txt', 'a scratch file AMC uses while pulling a log off the vehicle; this tab fetches the log into memory'],
  ['params.param', 'an output name from AMC\'s standalone MAVFTP example script'],
  ['defaults.param', 'the same example script\'s companion output'],
  ['devid.json', 'a lookup table for decode_devid.py, shipped beside it'],
  ['{next_prefix:02d}_imported_{source}_parameters.param', 'AMC creates a PROJECT from a log or a connected vehicle and puts the leftovers in a numbered step file; this tab declares and computes instead, and writes the same information as fc_params_missing_or_different_*']
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
