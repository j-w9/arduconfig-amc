// Deriving a vehicle's declaration from its own parameters.
//
// AMC's templates are the oracle again, and an unusually good one here: each
// ships BOTH the operator's declaration (vehicle_components.json) and the
// vehicle's parameters (00_default.param plus the configured step files). So
// the question "does reading the parameters back produce what the operator
// said?" can be asked against 29 real aircraft.
//
// The contract is deliberately asymmetric. Deriving a field WRONG is a real
// failure: the sequence would compute confidently from it. Deriving FEWER
// fields than the operator declared is not — a parameter says how a vehicle
// is configured, which is not everything about how it is wired, and no
// parameter records a propeller's diameter.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  importComponentsFromParameters,
  parameterValues,
  parseParamFile
} from '../packages/amc-steps/dist/index.js'

const tables = JSON.parse(
  readFileSync(fileURLToPath(new URL('../steps/connection-tables.json', import.meta.url)), 'utf8')
)
const templatesDir = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', import.meta.url)
)

/**
 * A template's parameters as the finished vehicle has them: the firmware
 * defaults with every step file layered on top, which is what a configured
 * aircraft would report over MAVLink.
 */
function vehicleParameters(dir) {
  const params = existsSync(`${dir}/00_default.param`)
    ? parameterValues(parseParamFile(readFileSync(`${dir}/00_default.param`, 'utf8')))
    : {}
  for (const file of readdirSync(dir).filter((f) => /^\d+_.*\.param$/.test(f) && f !== '00_default.param').sort()) {
    Object.assign(params, parameterValues(parseParamFile(readFileSync(`${dir}/${file}`, 'utf8'))))
  }
  return params
}

function templates(vehicle) {
  const dir = `${templatesDir}${vehicle}`
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => ({ name, dir: `${dir}/${name}`, vehicle }))
    .filter((t) => existsSync(`${t.dir}/vehicle_components.json`))
}

const ALL = ['ArduCopter', 'ArduPlane', 'Rover', 'Heli'].flatMap(templates)

/** `{ 'Battery/Specifications/Chemistry': 'Lipo' }` from the nested document. */
function flatten(node, trail = [], out = {}) {
  if (node === null || typeof node !== 'object') {
    if (node !== undefined && node !== '') out[trail.join('/')] = String(node)
    return out
  }
  for (const [key, child] of Object.entries(node)) flatten(child, [...trail, key], out)
  return out
}

const declaredValue = (components, path) => {
  let node = components
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[key]
  }
  if (node === undefined || node === null || typeof node === 'object') return undefined
  const value = String(node)
  // "Undefined" is the placeholder a template carries for a question nobody
  // answered, not an answer. Deriving over it is the feature working.
  return value === '' || value === 'Undefined' ? undefined : value
}

/**
 * Whether the vehicle's own parameters support the operator's declared port.
 *
 * Chimera7 declares its telemetry on SERIAL4 while SERIAL4_PROTOCOL is 5 —
 * GPS. The declaration and the parameters contradict each other, and no amount
 * of care reading the parameters can produce SERIAL4 from them.
 */
function parametersSupport(params, path, declared) {
  if (path[2] !== 'Type' || !/^SERIAL\d$/.test(declared)) return true
  const component = path[0] === 'GNSS Receiver' ? 'GNSS Receiver' : path[0]
  const protocol = params[`${declared}_PROTOCOL`]
  if (protocol === undefined) return false
  const entry = tables.SERIAL_PROTOCOLS_DICT[String(Math.trunc(protocol))]
  return entry?.component === component
}

/** Compare as numbers when both are numeric, so "4" and "4.0" agree. */
function agrees(derived, declared) {
  if (derived === declared) return true
  const a = Number(derived)
  const b = Number(declared)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6
}

test('what is derived from a vehicle agrees with what its operator declared', () => {
  const disagreements = []
  const contradictions = []
  let compared = 0

  for (const template of ALL) {
    // Heli's sequence runs on Copter firmware, and the ESC/frame tables are
    // keyed by firmware rather than by airframe.
    const firmware = template.vehicle === 'Heli' ? 'Heli' : template.vehicle
    const components = JSON.parse(readFileSync(`${template.dir}/vehicle_components.json`, 'utf8')).Components
    // The operator's existing declaration is an INPUT, exactly as it is in
    // AMC: several chemistries share a volt-per-cell figure, so what they
    // already said is often the only thing that can break the tie.
    const { derived } = importComponentsFromParameters(vehicleParameters(template.dir), tables, firmware, {
      current: flatten(components)
    })

    const params = vehicleParameters(template.dir)
    for (const entry of derived) {
      const declared = declaredValue(components, entry.path)
      // The operator left it blank: nothing to disagree with, and deriving it
      // is the whole point.
      if (declared === undefined) continue
      compared += 1
      if (agrees(entry.value, declared)) continue
      if (!parametersSupport(params, entry.path, declared)) {
        // The declaration contradicts the vehicle's own parameters. Reading
        // them cannot produce it, and reading them correctly is all this does.
        contradictions.push(`${template.vehicle}/${template.name} ${entry.path.join('/')}`)
        continue
      }
      disagreements.push(
        `${template.vehicle}/${template.name} ${entry.path.join('/')}: vehicle says ${entry.value}, operator declared ${declared} (from ${entry.from.join(', ')})`
      )
    }
  }

  assert.ok(ALL.length >= 25, `only ${ALL.length} templates found`)
  assert.ok(compared > 200, `only ${compared} fields compared — the import is deriving almost nothing`)
  assert.equal(
    disagreements.length,
    0,
    `${disagreements.length} of ${compared} derived fields disagree with the operator:\n${disagreements.slice(0, 15).join('\n')}`
  )
  // The escape hatch above must stay narrow, or it would excuse anything.
  assert.ok(
    contradictions.length <= 2,
    `${contradictions.length} declarations contradict their own parameters, which is more than these templates are known to contain:\n${contradictions.join('\n')}`
  )
})

test('a configured vehicle fills in most of what the form asks', () => {
  // The point of the feature. If it derived three fields it would be a curio.
  const counts = ALL.map((t) => {
    const firmware = t.vehicle === 'Heli' ? 'Heli' : t.vehicle
    return importComponentsFromParameters(vehicleParameters(t.dir), tables, firmware).derived.length
  })
  const median = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)]
  assert.ok(median >= 10, `a typical vehicle only yields ${median} fields`)
})

test('every derived field names the parameters it came from', () => {
  // An operator who disagrees needs to know what to look at, and a field that
  // cannot say where it came from cannot be argued with.
  for (const template of ALL.slice(0, 5)) {
    const firmware = template.vehicle === 'Heli' ? 'Heli' : template.vehicle
    const params = vehicleParameters(template.dir)
    for (const entry of importComponentsFromParameters(params, tables, firmware).derived) {
      assert.ok(entry.from.length > 0, `${entry.path.join('/')} cites nothing`)
      for (const name of entry.from) {
        assert.ok(name in params, `${entry.path.join('/')} cites ${name}, which the vehicle does not have`)
      }
    }
  }
})

test('a vehicle with no parameters derives nothing rather than guessing', () => {
  // A parameter the vehicle never reported is one we have not read, not one
  // set to zero. AMC defaults an absent GPS_TYPE to 0 and declares "no GNSS";
  // here an absent parameter says nothing, because writing "None" into the
  // operator's declaration on that basis is a guess wearing a fact's clothes.
  const { derived } = importComponentsFromParameters({}, tables, 'ArduCopter')
  assert.deepEqual(derived, [])
})

test('a parameter that IS present and zero is read as zero', () => {
  // The other half of the rule above: 0 is a real answer when the vehicle
  // actually reports it.
  const { derived } = importComponentsFromParameters({ GPS1_TYPE: 0 }, tables, 'ArduCopter')
  assert.equal(
    derived.find((d) => d.path.join('/') === 'GNSS Receiver/FC Connection/Type')?.value,
    'None'
  )
})

test('an ambiguous RC_PROTOCOLS bitmask is reported, not guessed', () => {
  // Several protocols enabled means the vehicle will accept any of them, and
  // which one the receiver actually speaks is not in the parameters.
  const { derived, undetermined } = importComponentsFromParameters(
    { RC_PROTOCOLS: 2 + 8 }, // PPM and SBUS
    tables,
    'ArduCopter'
  )
  assert.ok(undetermined.some((m) => /RC_PROTOCOLS/.test(m)), undetermined.join('; '))
  assert.ok(
    !derived.some((d) => d.path.join('/') === 'RC Receiver/FC Connection/Protocol'),
    'a protocol was guessed from an ambiguous bitmask'
  )
  // The connection type is still known: something is on the RC input.
  assert.equal(
    derived.find((d) => d.path.join('/') === 'RC Receiver/FC Connection/Type')?.value,
    'RCin/SBUS'
  )
})

test('a single-bit RC_PROTOCOLS names the protocol', () => {
  const { derived } = importComponentsFromParameters({ RC_PROTOCOLS: 8 }, tables, 'ArduCopter')
  assert.equal(
    derived.find((d) => d.path.join('/') === 'RC Receiver/FC Connection/Protocol')?.value,
    'SBUS'
  )
})

test('the battery cell count comes from the voltages', () => {
  // 25.2 V at 4.2 V per cell is six cells.
  const { derived } = importComponentsFromParameters(
    { MOT_BAT_VOLT_MAX: 25.2, BATT_CAPACITY: 5200 },
    tables,
    'ArduCopter'
  )
  const by = (p) => derived.find((d) => d.path.join('/') === p)?.value
  assert.equal(by('Battery/Specifications/Number of cells'), '6')
  assert.equal(by('Battery/Specifications/Volt per cell max'), '4.2')
  assert.equal(by('Battery/Specifications/Capacity mAh'), '5200')
  // NOT asserted as Lipo: LiIonSS, Lipo and LipoHVSS all sit at 4.2 V per
  // cell, so a maximum voltage cannot tell them apart. AMC resolves the tie by
  // dictionary order and lands on LiIonSS; this port does the same, and
  // pretending the answer is Lipo would be asserting a coincidence.
  assert.equal(by('Battery/Specifications/Chemistry'), 'LiIonSS')
})

test('a voltage that only one chemistry fits identifies it', () => {
  // Where the chemistries actually differ, detection is decisive: 21.6 V is
  // six cells at Lipo's 3.6 V low, and no other chemistry divides it evenly.
  const { derived } = importComponentsFromParameters({ BATT_LOW_VOLT: 21.6 }, tables, 'ArduCopter')
  const by = (p) => derived.find((d) => d.path.join('/') === p)?.value
  assert.equal(by('Battery/Specifications/Chemistry'), 'Lipo')
  assert.equal(by('Battery/Specifications/Number of cells'), '6')
})

test('a GNSS on CAN is attributed to the bus that is actually driving it', () => {
  const onBus2 = importComponentsFromParameters(
    { GPS1_TYPE: 9, CAN_D2_PROTOCOL: 1, CAN_P2_DRIVER: 1 },
    tables,
    'ArduCopter'
  )
  const type = onBus2.derived.find((d) => d.path.join('/') === 'GNSS Receiver/FC Connection/Type')
  assert.equal(type?.value, 'CAN2')
  // And it says which parameters settled it.
  assert.ok(type?.from.includes('CAN_D2_PROTOCOL'))

  // A DroneCAN GPS with no bus configured for DroneCAN is a contradiction in
  // the vehicle's own parameters, and NEITHER half is claimed: keeping the
  // protocol would let the serial scan pair "DroneCAN" with "SERIAL3", a
  // declaration that cannot be true and that the sequence would compute from.
  const unconfigured = importComponentsFromParameters(
    { GPS1_TYPE: 9, SERIAL3_PROTOCOL: 5 },
    tables,
    'ArduCopter'
  )
  assert.ok(unconfigured.undetermined.some((m) => /CAN/.test(m)), unconfigured.undetermined.join('; '))
  const paths = unconfigured.derived.map((d) => d.path.join('/'))
  assert.ok(!paths.includes('GNSS Receiver/FC Connection/Protocol'), 'an unusable protocol was claimed')
})

test('a serial ESC protocol takes the control connection; a telemetry-only one does not', () => {
  // FETtecOneWire carries both directions on the one port.
  const serialEsc = importComponentsFromParameters({ SERIAL1_PROTOCOL: 38 }, tables, 'ArduCopter')
  const by = (r, p) => r.derived.find((d) => d.path.join('/') === p)?.value
  assert.equal(by(serialEsc, 'ESC/FC->ESC Connection/Type'), 'SERIAL1')

  // ESC Telemetry is telemetry only: the FC still drives the ESCs over PWM, so
  // MOT_PWM_TYPE must still decide the control connection.
  const telemetryOnly = importComponentsFromParameters(
    { SERIAL5_PROTOCOL: 16, MOT_PWM_TYPE: 6 },
    tables,
    'ArduCopter'
  )
  assert.equal(by(telemetryOnly, 'ESC/ESC->FC Telemetry/Type'), 'SERIAL5')
  assert.equal(by(telemetryOnly, 'ESC/FC->ESC Connection/Type'), 'Main Out')
})
