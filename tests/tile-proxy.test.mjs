import assert from 'node:assert/strict'
import test from 'node:test'

// Imported as TypeScript: Node strips the types.
import { onRequestGet } from '../functions/tiles/[z]/[x]/[y].ts'

/*
 * The /tiles proxy is what keeps the maps working on a cross-origin-isolated
 * page, and it is what this branch has instead of upstream's fix for OSM
 * blocking tiles. So what it sends OSM, and what it refuses to fetch, are
 * pinned here rather than discovered on the live site.
 */

function withFetch(fake, run) {
  const real = globalThis.fetch
  globalThis.fetch = fake
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = real
  })
}

const call = (z, x, y) => onRequestGet({ params: { z, x, y } })

test('asks OSM for exactly the tile requested, identifying the site', async () => {
  const seen = []
  await withFetch(
    async (url, init) => {
      seen.push({ url, headers: init.headers })
      return new Response(new Uint8Array([0x89, 0x50]), { status: 200 })
    },
    async () => {
      const response = await call('3', '7', '4')
      assert.equal(response.status, 200)
    }
  )
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://tile.openstreetmap.org/3/7/4.png')
  // OSM answers an anonymous request with an "Access blocked" image, which
  // is a 200 and looks like a tile -- so the identity is the thing to check.
  assert.match(seen[0].headers['User-Agent'], /amc\.arduconfigurator\.com/)
  assert.match(seen[0].headers.Referer, /^https:\/\/amc\.arduconfigurator\.com\//)
})

test('serves it same-origin, which is the point of the exercise', async () => {
  await withFetch(
    async () => new Response(new Uint8Array([0x89]), { status: 200 }),
    async () => {
      const response = await call('1', '0', '0')
      assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin')
      assert.equal(response.headers.get('Content-Type'), 'image/png')
    }
  )
})

test('refuses anything that is not a tile, without fetching', async () => {
  // An unvalidated proxy is an open proxy.
  let fetched = 0
  await withFetch(
    async () => {
      fetched += 1
      return new Response('', { status: 200 })
    },
    async () => {
      for (const [z, x, y] of [['20', '0', '0'], ['3', '8', '0'], ['3', '-1', '0'], ['a', '0', '0'], ['2', '1.5', '0']]) {
        assert.equal((await call(z, x, y)).status, 400, `${z}/${x}/${y}`)
      }
    }
  )
  assert.equal(fetched, 0)
})

test('says the tile is unavailable rather than passing OSM’s error through', async () => {
  await withFetch(
    async () => new Response('', { status: 403 }),
    async () => assert.equal((await call('3', '7', '4')).status, 502)
  )
})
