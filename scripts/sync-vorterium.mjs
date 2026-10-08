// Gera o motor como biblioteca e copia pro Vorterium (código + assets).
//   node scripts/sync-vorterium.mjs [pasta-do-vorterium]
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const target = resolve(process.argv[2] ?? '../vorterium')
if (!existsSync(resolve(target, 'package.json'))) throw new Error(`Vorterium não encontrado em ${target}`)

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
run('npx vite build -c vite.lib.config.ts')
run('npx tsc -p tsconfig.lib.json')

const code = resolve(target, 'src/vendor/vortable')
rmSync(code, { recursive: true, force: true })
mkdirSync(code, { recursive: true })
cpSync('dist-lib/vortable.js', resolve(code, 'vortable.js'))
cpSync('dist-lib/types', resolve(code, 'types'), { recursive: true })
writeFileSync(resolve(code, 'vortable.d.ts'), "export * from './types/index'\n")

const assets = resolve(target, 'public/vortable/assets')
rmSync(assets, { recursive: true, force: true })
cpSync('public/assets', assets, { recursive: true })
// mundos prontos (maps/*.mundo.json): o painel Mundos do Vorterium oferece como modelos
const maps = resolve(target, 'public/vortable/maps')
rmSync(maps, { recursive: true, force: true })
if (existsSync('maps')) {
  mkdirSync(maps, { recursive: true })
  for (const f of readdirSync('maps')) if (f.endsWith('.mundo.json')) cpSync(resolve('maps', f), resolve(maps, f))
}
console.log(`\nCopiado pra ${target}\n  código: src/vendor/vortable\n  assets: public/vortable/assets`)
