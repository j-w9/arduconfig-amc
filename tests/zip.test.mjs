// The store-only zip writer, checked against something that is not itself.
//
// A hand-written archive format is easy to get almost right: the bytes look
// plausible, the tests pass, and the file fails to open in the one place it
// matters. So the assertion here is that the SYSTEM's unzip reads it back --
// the archive is written to disk and extracted by the platform tool, not by a
// reader written alongside the writer and sharing its misunderstandings.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildZip } from '../packages/amc-steps/dist/index.js'

function extract(bytes, entries) {
  const dir = mkdtempSync(join(tmpdir(), 'amc-zip-'))
  try {
    const archive = join(dir, 'vehicle.zip')
    writeFileSync(archive, bytes)
    const out = join(dir, 'out')
    // -q quiet, -d destination. Exits non-zero on a malformed archive, which
    // is the failure this test exists to catch.
    execFileSync('unzip', ['-q', archive, '-d', out])
    return new Map(readdirSync(out).map((name) => [name, readFileSync(join(out, name), 'utf8')]))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the system unzip reads the archive, with every file intact', () => {
  const entries = [
    { filename: '00_default.param', text: 'INS_GYR_CAL,1\nBATT_MONITOR,4\n' },
    { filename: '04_board_orientation.param', text: 'AHRS_ORIENTATION,0  # Board mounted level\n' },
    // Deliberately empty: a step that decided nothing still gets a file, and
    // a zero-length member is where an off-by-one in the header shows up.
    { filename: '18_osd.param', text: '' }
  ]
  const extracted = extract(buildZip(entries), entries)
  assert.equal(extracted.size, entries.length)
  for (const entry of entries) {
    assert.equal(extracted.get(entry.filename), entry.text, `${entry.filename} did not survive`)
  }
})

test('a non-ASCII reason survives, because the flag says UTF-8', () => {
  // Reasons come from AMC's step files and are not all ASCII. Without the
  // UTF-8 flag these decode as mojibake in some tools -- readable enough that
  // nobody notices until the reason is the thing being read.
  const text = 'MOT_THST_EXPO,0.65  # Propeller thrust curve — 5″ props\n'
  const extracted = extract(buildZip([{ filename: '10_battery.param', text }]))
  assert.equal(extracted.get('10_battery.param'), text)
})

test('the same configuration written twice is byte-identical', () => {
  // An operator diffing two exports should see what changed in the vehicle,
  // not a timestamp. This is why the DOS date/time are pinned.
  const entries = [{ filename: '01_imu.param', text: 'INS_TCAL1_ENABLE,2\n' }]
  assert.deepEqual(buildZip(entries), buildZip(entries))
})

test('entries keep the order they were given', () => {
  // The sequence's order is the useful one, and a zip preserves whatever the
  // writer put in the central directory.
  const names = ['00_default.param', '01_imu.param', '02_imu_results.param']
  const bytes = buildZip(names.map((filename) => ({ filename, text: `# ${filename}\n` })))
  const listed = execFileSyncListing(bytes)
  assert.deepEqual(listed, names)
})

function execFileSyncListing(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'amc-zip-'))
  try {
    const archive = join(dir, 'vehicle.zip')
    writeFileSync(archive, bytes)
    // -1 lists names only, in central-directory order.
    return execFileSync('unzip', ['-Z', '-1', archive], { encoding: 'utf8' }).trim().split('\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
