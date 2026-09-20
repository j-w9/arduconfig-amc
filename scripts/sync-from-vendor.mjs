// Copy the configuration-step data out of the pinned AMC submodule into steps/.
//
// The fork consumes AMC's guided sequence as *data*, not as a Python runtime:
// these JSON files are the whole sequence, and everything else here is a
// TypeScript reimplementation of the little that interprets them. Re-run this
// after bumping the vendor/MethodicConfigurator pin.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
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

// The values AMC's own vehicle templates use, per component field.
//
// Several fields are enumerations that AMC's editor fills from Python tables --
// connection types, MCU series -- which would mean copying and then maintaining
// those lists. The 29 vendored templates already contain real answers for every
// field, so the suggestions are read from them instead and stay true to
// whatever upstream ships.
const templatesDir = join(src, 'vehicle_templates')
const observed = new Map()
const walkComponents = (node, trail) => {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    if (node === '' || node === null || node === undefined) return
    const key = trail.join('/')
    if (!observed.has(key)) observed.set(key, new Set())
    observed.get(key).add(String(node))
    return
  }
  for (const [name, child] of Object.entries(node)) walkComponents(child, [...trail, name])
}

if (existsSync(templatesDir)) {
  // The directory also holds loose files alongside the per-vehicle folders.
  const directories = (path) =>
    readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory())
  for (const vehicle of directories(templatesDir)) {
    const vehicleDir = join(templatesDir, vehicle)
    for (const template of directories(vehicleDir)) {
      const file = join(vehicleDir, template, 'vehicle_components.json')
      if (!existsSync(file)) continue
      try {
        walkComponents(JSON.parse(readFileSync(file, 'utf8')).Components ?? {}, [])
      } catch {
        // A template we cannot read contributes no suggestions; the field just
        // falls back to free text.
      }
    }
  }
}

writeFileSync(
  join(dest, 'component-values.json'),
  JSON.stringify(
    Object.fromEntries([...observed].map(([key, values]) => [key, [...values].sort()])),
    null,
    1
  ) + '\n'
)

const pin = execFileSync('git', ['-C', join(root, 'vendor/MethodicConfigurator'), 'rev-parse', 'HEAD'])
  .toString()
  .trim()
writeFileSync(
  join(dest, 'PROVENANCE.json'),
  JSON.stringify({ upstream: 'https://github.com/ArduPilot/MethodicConfigurator', commit: pin, files: wanted, syncedBy: 'scripts/sync-from-vendor.mjs' }, null, 2) + '\n'
)
console.log(
  `synced ${wanted.length} step files and ${observed.size} observed component fields from AMC @ ${pin.slice(0, 8)}`
)
