// Put the SITL WebAssembly artifacts where Vite will serve them.
//
// The binaries are committed in the fork (sitl/), because that is where this
// experiment's own assets live and the app repo is otherwise all source. Vite
// only copies apps/web/public/ into dist, so they are staged across before a
// build -- and ignored there, so the app repo never carries them.
//
// Run by `npm run sitl:stage`, and by the deploy workflow before build:web.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'sitl')
const to = join(root, 'apps/arduconfigurator/apps/web/public/sitl')

if (!existsSync(from)) {
  // Not an error: a checkout that has never built SITL still builds the site,
  // and the tab says it has nothing to load rather than the build failing.
  console.log('no sitl/ to stage — run `npm run sitl:build` first')
  process.exit(0)
}

/**
 * Staged under a build-specific directory, not a fixed one.
 *
 * These files are large and their contents rarely change, so a CDN holds them
 * for a long time -- headers included. They were first deployed before the
 * cross-origin isolation headers existed, and the stale edge copies kept being
 * served without them: the page fetched the module fine, the pthread worker
 * request got a headerless variant, and the simulator hung on "starting worker
 * threads" with ERR_BLOCKED_BY_RESPONSE. It reproduced only in browsers with a
 * warm profile, which is why fresh test runs kept passing.
 *
 * A path that changes whenever the artifacts do cannot collide with a stale
 * entry. The hash is over the files themselves, so an unchanged build keeps
 * its URL and stays cached.
 */
/**
 * Bump to force a new path when the FILES are unchanged but the URL must be.
 *
 * A CDN caches headers along with the body, so a response cached while the
 * headers were wrong stays wrong until something changes -- and a
 * content-addressed path does not change when the content did not. That
 * happened once: a duplicated Cross-Origin-Embedder-Policy got cached, which
 * the worker-script check rejects as invalid, and the simulator hung on
 * "starting worker threads" for anyone the edge served that copy to.
 */
const LAYOUT = 2

const digest = createHash('sha256')
digest.update(String(LAYOUT))
for (const name of readdirSync(from).sort()) {
  digest.update(name)
  digest.update(readFileSync(join(from, name)))
}
const build = digest.digest('hex').slice(0, 12)

const versioned = join(to, build)
mkdirSync(versioned, { recursive: true })
cpSync(from, versioned, { recursive: true })

// The tab reads this to know where the modules are; it is small and always
// fetched fresh, so it is the one thing that must not be versioned.
writeFileSync(join(to, 'build.json'), JSON.stringify({ build }, null, 1) + '\n')

const staged = readdirSync(versioned)
console.log(`staged ${staged.length} files into apps/web/public/sitl/${build}/`)
