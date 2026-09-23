// Put the SITL WebAssembly artifacts where Vite will serve them.
//
// The binaries are committed in the fork (sitl/), because that is where this
// experiment's own assets live and the app repo is otherwise all source. Vite
// only copies apps/web/public/ into dist, so they are staged across before a
// build -- and ignored there, so the app repo never carries them.
//
// Run by `npm run sitl:stage`, and by the deploy workflow before build:web.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
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

mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })
const staged = readdirSync(to)
console.log(`staged ${staged.length} files into apps/web/public/sitl/: ${staged.join(', ')}`)
