/**
 * A vehicle directory, as one file the browser can hand over.
 *
 * Store-only (no compression), written by hand rather than pulled in as a
 * dependency. Two reasons, and the second is the real one:
 *
 *   - Parameter files are small text. Deflate would save little and cost a
 *     dependency in the path that produces the artefact an operator keeps.
 *   - A zip writer is the sort of thing that is easy to get almost right. A
 *     store-only archive is short enough to read in full and to test byte for
 *     byte, so "almost" is visible.
 *
 * The output is deterministic: no timestamps from the clock, no ordering from
 * a hash map. The same configuration written twice produces identical bytes,
 * which is what lets an operator diff two exports and see only what changed.
 */

export interface ZipEntry {
  readonly filename: string
  readonly text: string
}

// MS-DOS epoch (1980-01-01 00:00:00). Deliberately fixed: a wall-clock
// timestamp would make two exports of the same configuration differ.
const DOS_TIME = 0
const DOS_DATE = 0x0021

/**
 * Build a store-only zip.
 *
 * Entries are written in the order given, so a caller that wants the
 * sequence's order gets it.
 */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.filename)
    const data = encoder.encode(entry.text)
    const crc = crc32(data)

    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true) // local file header signature
    localView.setUint16(4, 20, true) // version needed: 2.0
    localView.setUint16(6, 0x0800, true) // flags: filename is UTF-8
    localView.setUint16(8, 0, true) // method: stored
    localView.setUint16(10, DOS_TIME, true)
    localView.setUint16(12, DOS_DATE, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.length, true) // compressed size
    localView.setUint32(22, data.length, true) // uncompressed size
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true) // extra field length
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true) // central directory signature
    centralView.setUint16(4, 20, true) // version made by
    centralView.setUint16(6, 20, true) // version needed
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, DOS_TIME, true)
    centralView.setUint16(14, DOS_DATE, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true) // extra field length
    centralView.setUint16(32, 0, true) // comment length
    centralView.setUint16(34, 0, true) // disk number start
    centralView.setUint16(36, 0, true) // internal attributes
    centralView.setUint32(38, 0, true) // external attributes
    centralView.setUint32(42, offset, true) // offset of local header
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true) // end of central directory
  endView.setUint16(4, 0, true) // this disk
  endView.setUint16(6, 0, true) // disk with central directory
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  endView.setUint16(20, 0, true) // comment length

  return concat([...locals, ...centrals, end])
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// Built once on first use rather than at module load: this module is imported
// by anything that touches vehicle files, and most of them never write a zip.
let crcTable: Uint32Array | undefined

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i += 1) {
      let c = i
      for (let bit = 0; bit < 8; bit += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      crcTable[i] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] as number)
  }
  return (crc ^ 0xffffffff) >>> 0
}
