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

// The empty templates, as the baseline a directory starts from.
//
// AMC seeds a vehicle directory by copying a template's .param files and then
// lets the sequence edit them. When it creates a project from a connected
// flight controller it uses the EMPTY template matching that firmware --
// empty_<major>.<minor>.x -- not somebody's aircraft
// (data_model_vehicle_project._get_fc_template_dir_for_project_creation).
//
// That is the honest baseline to carry across: firmware-shaped starting
// values with none of the geometry, wiring or tuning that belongs to whoever
// contributed a real template.
const baselines = {}
for (const vehicle of readdirSync(templatesDir)) {
  const vehicleDir = join(templatesDir, vehicle)
  if (!statSync(vehicleDir).isDirectory()) continue
  for (const entry of readdirSync(vehicleDir)) {
    const match = /^empty_(\d+)\.(\d+)\.x$/.exec(entry)
    if (!match) continue
    const files = {}
    for (const file of readdirSync(join(vehicleDir, entry))) {
      if (!file.endsWith('.param')) continue
      files[file] = readFileSync(join(vehicleDir, entry, file), 'utf8')
    }
    if (Object.keys(files).length === 0) continue
    baselines[vehicle] ??= {}
    baselines[vehicle][`${match[1]}.${match[2]}`] = files
  }
}

emit('baselines.json', JSON.stringify(baselines, null, 1) + '\n')

// What AMC's directories hold that this sequence never decides.
//
// AMC seeds a vehicle directory by COPYING a template's .param files and then
// lets the sequence edit them; this fork computes purely from the step
// directives. So most of an AMC directory is template content -- 69 of the 662
// parameters in empty_4.6.x come from directives, and the rest do not.
//
// Copying those values wholesale would be wrong: GPS_POS1_X is one particular
// aircraft's antenna offset, not this one's. What can be carried across
// honestly is the QUESTION -- which parameters AMC's templates consistently
// set for each step -- so the tab can say what the sequence does not decide
// instead of leaving it unmentioned.
//
// "Decided by the sequence" is judged structurally: a parameter NAMED by any
// directive of that step, guard or no guard. If the sequence mentions it at
// all it is the sequence's business; everything else is template content.
const stepsByVehicle = new Map()
for (const f of wanted) {
  const vehicle = f.replace(/^configuration_steps_|\.json$/g, '')
  const parsed = JSON.parse(readFileSync(join(src, f), 'utf8'))
  const named = new Map()
  for (const [filename, step] of Object.entries(parsed.steps ?? {})) {
    const names = new Set()
    for (const group of ['forced_parameters', 'derived_parameters', 'add_parameters', 'delete_parameters']) {
      for (const parameter of Object.keys(step[group] ?? {})) names.add(parameter)
    }
    named.set(filename, names)
  }
  stepsByVehicle.set(vehicle, named)
}

/** Parameter names in a .param file, tolerant in the same places AMC is. */
function namesIn(text) {
  const names = []
  for (const raw of text.split(/\r?\n/)) {
    const hash = raw.indexOf('#')
    const body = (hash === -1 ? raw : raw.slice(0, hash)).trim()
    if (body.length === 0) continue
    const match = /^(\S+)[,\s]+\S+$/.exec(body)
    if (match) names.push(match[1])
  }
  return names
}

const templateOnly = {}
for (const [vehicle, named] of stepsByVehicle) {
  const vehicleDir = join(templatesDir, vehicle)
  if (!existsSync(vehicleDir)) continue
  const counts = new Map()
  let templateCount = 0
  for (const entry of readdirSync(vehicleDir)) {
    const dir = join(vehicleDir, entry)
    if (!statSync(dir).isDirectory()) continue
    templateCount += 1
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.param')) continue
      const decided = named.get(file)
      // A file no step of this sequence claims is not this sequence's concern.
      if (decided === undefined) continue
      for (const parameter of namesIn(readFileSync(join(dir, file), 'utf8'))) {
        if (decided.has(parameter)) continue
        const key = `${file}|${parameter}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  const byStep = {}
  for (const [key, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    const [file, parameter] = key.split('|')
    byStep[file] ??= {}
    byStep[file][parameter] = count
  }
  templateOnly[vehicle] = { templates: templateCount, steps: byStep }
}

emit('template-only.json', JSON.stringify(templateOnly, null, 1) + '\n')

// The tables extracted from AMC's Python (connection-tables.json,
// migration.json) are produced by scripts/extract-connection-tables.py, which
// executes the vendor's module literals -- there is no reading them from
// JavaScript. Run from here so one command syncs everything and `--check`
// covers them too; without this they sat outside the drift audit entirely,
// which is precisely the blind spot the audit exists to remove.
const extractor = join(root, 'scripts/extract-connection-tables.py')
const extracted = ['connection-tables.json', 'migration.json']
if (existsSync(extractor)) {
  const before = new Map(
    extracted.map((name) => [
      name,
      existsSync(join(dest, name)) ? readFileSync(join(dest, name), 'utf8') : undefined
    ])
  )
  try {
    execFileSync('python3', [extractor], { cwd: root, stdio: 'pipe' })
  } catch (error) {
    // A missing or too-old Python is a reason to say so, not to quietly report
    // that the extracted tables are in sync when nothing checked them.
    console.error(`could not run ${extractor}: ${error.message}`)
    process.exit(1)
  }
  if (checkOnly) {
    for (const [name, original] of before) {
      const now = existsSync(join(dest, name)) ? readFileSync(join(dest, name), 'utf8') : undefined
      if (now !== original) drifted.push(name)
      // The extractor writes in place, so the committed file is restored --
      // `--check` promises to touch nothing.
      if (original !== undefined && now !== original) writeFileSync(join(dest, name), original)
    }
  }
}

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
