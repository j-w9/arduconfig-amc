// What is committed here still being what AMC says.
//
// The sequence and every table the tab reads are derived from the pinned
// vendor submodule by scripts/sync-from-vendor.mjs, and nothing re-ran it. So
// the failure this guards is a pin that moved while the derived files stayed
// behind: the tab would describe a version of AMC nobody is running, every
// test would pass, and nothing would say so.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

test('steps/ is what the pinned AMC would produce today', () => {
  // --check writes nothing; it reports what a real sync would change.
  try {
    execFileSync('node', ['scripts/sync-from-vendor.mjs', '--check'], { cwd: root, encoding: 'utf8' })
  } catch (error) {
    assert.fail(error.stderr?.trim() || 'the vendor sync reports drift')
  }
})

test('the recorded pin is the submodule that is actually checked out', () => {
  // The other half of the same question. A PROVENANCE that names a commit the
  // submodule is not on means the files were synced from something else.
  const provenance = JSON.parse(readFileSync(new URL('../steps/PROVENANCE.json', import.meta.url), 'utf8'))
  const head = execFileSync('git', ['-C', 'vendor/MethodicConfigurator', 'rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  }).trim()
  assert.equal(provenance.commit, head)
})
