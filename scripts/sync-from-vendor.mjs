// Copy the configuration-step data out of the pinned AMC submodule into steps/.
//
// The fork consumes AMC's guided sequence as *data*, not as a Python runtime:
// these JSON files are the whole sequence, and everything else here is a
// TypeScript reimplementation of the little that interprets them. Re-run this
// after bumping the vendor/MethodicConfigurator pin.
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'vendor/MethodicConfigurator/ardupilot_methodic_configurator')
const dest = join(root, 'steps')

mkdirSync(dest, { recursive: true })

const wanted = readdirSync(src).filter(
  (f) => f.startsWith('configuration_steps_') && f.endsWith('.json')
)
for (const f of wanted) copyFileSync(join(src, f), join(dest, f))
copyFileSync(join(src, 'vehicle_components_schema.json'), join(dest, 'vehicle_components_schema.json'))

const pin = execFileSync('git', ['-C', join(root, 'vendor/MethodicConfigurator'), 'rev-parse', 'HEAD'])
  .toString()
  .trim()
writeFileSync(
  join(dest, 'PROVENANCE.json'),
  JSON.stringify({ upstream: 'https://github.com/ArduPilot/MethodicConfigurator', commit: pin, files: wanted, syncedBy: 'scripts/sync-from-vendor.mjs' }, null, 2) + '\n'
)
console.log(`synced ${wanted.length} step files from AMC @ ${pin.slice(0, 8)}`)
