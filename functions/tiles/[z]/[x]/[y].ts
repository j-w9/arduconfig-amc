/**
 * OpenStreetMap raster tiles, served from this origin.
 *
 * Cross-origin isolation — which the WebAssembly simulator needs, because
 * ArduPilot's main loop runs on a worker and that needs SharedArrayBuffer —
 * blocks cross-origin subresources that do not send a CORP header. OSM's tile
 * servers do not, so the maps would go blank the moment COEP is turned on.
 *
 * Proxying them through here makes them same-origin, which sidesteps the
 * question entirely and is also politer to OSM: their usage policy asks for a
 * caching layer rather than direct browser traffic, and Cloudflare gives one
 * for free.
 */

interface Params {
  z: string
  x: string
  y: string
}

/** OSM serves a 256px tile; z/x/y beyond these are not a map, they are a typo. */
const MAX_ZOOM = 19

export const onRequestGet: PagesFunction<unknown, keyof Params, Params> = async (context) => {
  const { z, x, y } = context.params
  const zoom = Number(z)
  const tileX = Number(x)
  const tileY = Number(y)
  const limit = 2 ** zoom

  // Validated rather than passed through: this is an open proxy otherwise, and
  // the only thing it should ever fetch is a tile.
  const valid =
    Number.isInteger(zoom) &&
    Number.isInteger(tileX) &&
    Number.isInteger(tileY) &&
    zoom >= 0 &&
    zoom <= MAX_ZOOM &&
    tileX >= 0 &&
    tileX < limit &&
    tileY >= 0 &&
    tileY < limit

  if (!valid) return new Response('Not a tile', { status: 400 })

  const upstream = `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`
  const response = await fetch(upstream, {
    headers: {
      // OSM's policy asks for an identifying User-Agent rather than a browser's.
      'User-Agent': 'ArduConfigurator-AMC (+https://amc.arduconfigurator.com)',
      Accept: 'image/png'
    },
    // Cloudflare's own cache, so a tile is fetched from OSM once per edge.
    cf: { cacheTtl: 60 * 60 * 24 * 7, cacheEverything: true }
  })

  if (!response.ok) return new Response('Tile unavailable', { status: 502 })

  const headers = new Headers()
  headers.set('Content-Type', 'image/png')
  headers.set('Cache-Control', 'public, max-age=604800, immutable')
  // The point of the exercise: same-origin, and explicitly so, for any future
  // context that checks.
  headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  return new Response(response.body, { headers })
}
