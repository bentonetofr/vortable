import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Curadoria de objetos (só no servidor de desenvolvimento): o editor manda
 * o ajuste de uma peça, gravamos no pack.json do pacote, refazemos o
 * catálogo desse pacote e devolvemos o catálogo novo.
 */
function curate(): Plugin {
  const packs = path.resolve('assets-src/packs')
  const catalog = path.resolve('public/assets/catalog/objects.json')
  return {
    name: 'vortable-curate',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__vortable/curate', (req, res) => {
        const reply = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return reply(405, { error: 'use POST' })
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          try {
            const { pack, id, override } = JSON.parse(raw)
            if (!/^[a-z0-9-]+$/.test(pack) || typeof id !== 'string' || !override || typeof override !== 'object') {
              return reply(400, { error: 'pedido inválido' })
            }
            const file = path.join(packs, pack, 'pack.json')
            if (!fs.existsSync(file)) return reply(404, { error: `pacote ${pack} não existe` })
            const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
            const objects = { ...(manifest.objects ?? {}), [id]: override }
            if (!Object.keys(override).length) delete objects[id]
            // ordem estável no arquivo (diffs legíveis)
            manifest.objects = Object.fromEntries(Object.entries(objects).sort(([a], [b]) => a.localeCompare(b)))
            fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
            execFile(process.execPath, ['scripts/build-catalog.mjs', '--pack', pack], (err, _out, stderr) => {
              if (err) return reply(500, { error: stderr || err.message })
              reply(200, JSON.parse(fs.readFileSync(catalog, 'utf8')))
            })
          } catch (err) {
            reply(500, { error: (err as Error).message })
          }
        })
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [curate()],
  server: {
    port: 5180,
    // a arte-fonte não interessa ao Vite (o catálogo gerado em public/ ele
    // precisa ver: é assim que arquivos novos passam a ser servidos)
    watch: { ignored: ['**/assets-src/**'] },
  },
  // o Phaser sozinho tem ~1,2 MB; o aviso padrão (500 kB) não ajuda aqui
  build: { chunkSizeWarningLimit: 1600 },
})
