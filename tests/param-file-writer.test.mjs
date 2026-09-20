// Writing AMC's own artifact.
//
// A configured vehicle in AMC is a directory of numbered .param files. If we
// are to produce one, a file written here has to be the same file AMC would
// write -- not merely equivalent, because these are kept in version control and
// a diff full of trailing zeros is worse than useless.
//
// So the test is the strongest one available: take every .param file AMC ships
// in its 29 vehicle templates, read it, write it back, and require the bytes to
// match.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  formatParamValue,
  linesFromEntries,
  parseParamFile,
  writeParamFile
} from '../packages/amc-steps/dist/index.js'

const templates = fileURLToPath(
  new URL('../vendor/MethodicConfigurator/ardupilot_methodic_configurator/vehicle_templates/', import.meta.url)
)

// The templates directory holds loose files beside the per-vehicle folders.
const directories = (path) => readdirSync(path).filter((name) => statSync(`${path}/${name}`).isDirectory())

function everyTemplateFile() {
  const files = []
  for (const vehicle of directories(templates)) {
    const vehicleDir = `${templates}${vehicle}`
    for (const name of directories(vehicleDir)) {
      const dir = `${vehicleDir}/${name}`
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.param')) files.push(`${dir}/${file}`)
      }
    }
  }
  return files
}

test('a value is rendered the way AMC renders it', () => {
  // format(value, '.6f').rstrip('0').rstrip('.')
  assert.equal(formatParamValue(30000), '30000')
  assert.equal(formatParamValue(78.1), '78.1')
  assert.equal(formatParamValue(86.801), '86.801')
  assert.equal(formatParamValue(-3.781446), '-3.781446')
  assert.equal(formatParamValue(0), '0')
  // A whole number never keeps a decimal point, which is what AMC's files show.
  assert.equal(formatParamValue(4.0), '4')
  // Six places, and no more.
  assert.equal(formatParamValue(1 / 3), '0.333333')
})

test('negative zero is written as zero', () => {
  // toFixed(6) gives "-0.000000", and a file reading -0 would be noise in a diff.
  assert.equal(formatParamValue(-0), '0')
})

test('every parameter file AMC ships round-trips byte for byte', () => {
  const files = everyTemplateFile()
  assert.ok(files.length > 500, `only ${files.length} template files found`)

  const mismatches = []
  let compared = 0
  for (const path of files) {
    const original = readFileSync(path, 'utf8')
    // A file carrying its own section comments is not ours to reproduce, and is
    // skipped rather than silently mangled. None do today, and the count below
    // is what keeps that honest: a test that skipped everything would pass.
    if (original.split(/\r?\n/).some((line) => line.trim().startsWith('#'))) continue

    compared += 1
    const rewritten = writeParamFile(linesFromEntries(parseParamFile(original)))
    if (rewritten !== original.replace(/\r\n/g, '\n')) {
      mismatches.push(path.slice(templates.length))
    }
  }

  assert.deepEqual(
    mismatches.slice(0, 8),
    [],
    `${mismatches.length} of ${compared} files did not survive a round trip`
  )
  assert.equal(compared, files.length, 'every file should have been compared, not skipped')
  assert.ok(compared > 1500, `only ${compared} files compared`)
})

test('a manual override survives the round trip', () => {
  // The marker records that the operator chose a value over the sequence's.
  // Losing it on a rewrite would quietly undo their decision the next time the
  // file is read.
  const original = 'LOG_BITMASK,407519  # @manual_override keeping Medium Attitude on\n'
  assert.equal(writeParamFile(linesFromEntries(parseParamFile(original))), original)
})

test('a parameter with no reason is written without one', () => {
  assert.equal(writeParamFile([{ name: 'BATT_CRT_MAH', value: 0 }]), 'BATT_CRT_MAH,0\n')
})

test('the file is sorted, so a diff shows what changed', () => {
  const text = writeParamFile([
    { name: 'ZZZ', value: 1 },
    { name: 'AAA', value: 2 }
  ])
  assert.equal(text, 'AAA,2\nZZZ,1\n')
})

test('an empty step writes an empty file rather than a stray newline', () => {
  assert.equal(writeParamFile([]), '')
})
