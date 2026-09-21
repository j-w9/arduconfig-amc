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

// `--check` answers "is what is committed still what the vendor says?" without
// touching anything. The failure it exists for is a vendor pin that moved
// while the derived files stayed behind: the sequence and every table read off
// AMC's templates would then be describing a version of AMC nobody is running,
// and nothing would say so. The audit test runs this.
const checkOnly = process.argv.includes('--check')
/** Paths whose committed contents differ from what this run would write. */
const drifted = []

function emit(filename, contents) {
  const path = join(dest, filename)
  if (!checkOnly) {
    writeFileSync(path, contents)
    return
  }
  const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
  if (current !== contents) drifted.push(filename)
}

function emitCopy(filename, from) {
  emit(filename, readFileSync(from, 'utf8'))
}

if (!checkOnly) mkdirSync(dest, { recursive: true })

const wanted = readdirSync(src).filter(
  (f) => f.startsWith('configuration_steps_') && f.endsWith('.json')
)
for (const f of wanted) emitCopy(f, join(src, f))
emitCopy('vehicle_components_schema.json', join(src, 'vehicle_components_schema.json'))

// The values AMC's own vehicle templates use, per component field.
//
// Several fields are enumerations that AMC's editor fills from Python tables --
// connection types, MCU series -- which would mean copying and then maintaining
// those lists. The 29 vendored templates already contain real answers for every
// field, so the suggestions are read from them instead and stay true to
// whatever upstream ships.
const templatesDir = join(src, 'vehicle_templates')
const observed = new Map()
// Which Protocol values were seen alongside each Type, within one connection
// group. A serial connection does not carry an analog protocol and a CAN one
// carries DroneCAN, so the pairing is real -- but the templates are evidence,
// not the whole truth, so this narrows the ORDER a field offers rather than
// the set. Hiding a valid protocol because no template happened to use it
// would be worse than showing an unlikely one.
const pairings = new Map()
// Each template's declaration, keyed "<vehicle>/<template>".
const templates = {}
const notePairing = (component, group, node) => {
  const type = node?.Type
  const protocol = node?.Protocol
  if (type === undefined || protocol === undefined) return
  if (type === '' || protocol === '') return
  const key = `${component}/${group}`
  if (!pairings.has(key)) pairings.set(key, new Map())
  const byType = pairings.get(key)
  if (!byType.has(String(type))) byType.set(String(type), new Set())
  byType.get(String(type)).add(String(protocol))
}
const walkPairings = (components) => {
  for (const [component, groups] of Object.entries(components ?? {})) {
    if (groups === null || typeof groups !== 'object') continue
    for (const [group, node] of Object.entries(groups)) {
      if (node === null || typeof node !== 'object') continue
      notePairing(component, group, node)
    }
  }
}
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
        const components = JSON.parse(readFileSync(file, 'utf8')).Components ?? {}
        walkComponents(components, [])
        walkPairings(components)
        // The template itself, as a starting point an operator can choose. A
        // vehicle much like one AMC already describes is most of the
        // declaration form answered by someone who owned that aircraft.
        templates[`${vehicle}/${template}`] = components
      } catch {
        // A template we cannot read contributes no suggestions; the field just
        // falls back to free text.
      }
    }
  }
}

emit(
  'component-values.json',
  JSON.stringify(
    Object.fromEntries([...observed].map(([key, values]) => [key, [...values].sort()])),
    null,
    1
  ) + '\n'
)

emit(
  'component-pairings.json',
  JSON.stringify(
    Object.fromEntries(
      [...pairings]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, byType]) => [
          key,
          Object.fromEntries(
            [...byType].sort(([a], [b]) => a.localeCompare(b)).map(([type, values]) => [type, [...values].sort()])
          )
        ])
    ),
    null,
    1
  ) + '\n'
)

emit(
  'vehicle-templates.json',
  JSON.stringify(
    Object.fromEntries(Object.entries(templates).sort(([a], [b]) => a.localeCompare(b))),
    null,
    1
  ) + '\n'
)

const pin = execFileSync('git', ['-C', join(root, 'vendor/MethodicConfigurator'), 'rev-parse', 'HEAD'])
  .toString()
  .trim()
emit(
  'PROVENANCE.json',
  JSON.stringify({ upstream: 'https://github.com/ArduPilot/MethodicConfigurator', commit: pin, files: wanted, syncedBy: 'scripts/sync-from-vendor.mjs' }, null, 2) + '\n'
)
if (checkOnly) {
  if (drifted.length > 0) {
    console.error(
      `${drifted.length} file(s) no longer match AMC @ ${pin.slice(0, 8)}: ${drifted.join(', ')}\n` +
        'Run `npm run sync` and commit the result.'
    )
    process.exit(1)
  }
  console.log(`steps/ is in sync with AMC @ ${pin.slice(0, 8)}`)
} else {
  console.log(
    `synced ${wanted.length} step files, ${observed.size} observed component fields, ${pairings.size} connection pairings and ${Object.keys(templates).length} vehicle templates from AMC @ ${pin.slice(0, 8)}`
  )
}
