// ────────────────────────────────────────────────────────
// Carrega a arte compartilhada (terrenos, catálogos e folhas de objetos)
// e registra os quadros nomeados. Depois avisa quem montou o jogo.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import {
  TERRAIN_CATALOG_URL, TERRAIN_GEN_TEXTURE, TERRAIN_TEXTURE, TERRAIN_URL, TERRAINS, addTerrains, genSources,
  terrainFrame, terrainFrameRect, terrainSheetTexture, terrainTexture, wangFrame, type TerrainCatalog,
} from '../assets/terrains'
import { buildGeneratedTerrains } from '../assets/genTerrain'
import { CATALOG_URL, setObjectCatalog, sheetTexture, type ObjectCatalog } from '../assets/objects'
import { registerObjectArt } from '../world/objects'

export class BootScene extends Phaser.Scene {
  constructor(private assetBase: string, private onReady: () => void) {
    super('boot')
  }

  private failed: string[] = []
  private status?: Phaser.GameObjects.Text

  preload() {
    this.status = this.add.text(16, 16, 'Carregando...', { color: '#a08e7a', fontFamily: 'system-ui' })
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => this.failed.push(file.src))
    this.load.image(TERRAIN_TEXTURE, this.assetBase + TERRAIN_URL)
    this.load.json('catalog', this.assetBase + CATALOG_URL)
    this.load.json('terrains', this.assetBase + TERRAIN_CATALOG_URL)
  }

  /** Sem a arte básica não dá pra montar nada: mostra o que faltou e para. */
  private fail() {
    console.error('[vortable] arte não carregou:', this.failed)
    const lines = ['Não deu pra carregar a arte do Vortable:', ...this.failed, '', 'Confira a pasta de assets e recarregue.']
    this.status?.setText(lines.join('\n')).setColor('#ef4444')
  }

  create() {
    if (this.failed.length) return this.fail()

    // segunda leva: folhas dos terrenos de pacote, texturas-fonte e folhas de objetos
    const terrains = this.cache.json.get('terrains') as TerrainCatalog
    addTerrains(terrains.terrains)
    for (const s of terrains.sheets) this.load.image(terrainSheetTexture(s.id), this.assetBase + s.url)
    for (const url of genSources()) this.load.image(`gensrc:${url}`, this.assetBase + url)

    const catalog = this.cache.json.get('catalog') as ObjectCatalog
    setObjectCatalog(catalog)
    for (const s of catalog.sheets) this.load.image(sheetTexture(s.id), this.assetBase + s.url)

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.failed.length) return this.fail()
      this.registerTerrains()
      registerObjectArt(this, catalog)
      this.onReady()
    })
    this.load.start()
  }

  private registerTerrains() {
    // pisos e paredes gerados: montados agora a partir das texturas-fonte
    const sources = new Map(genSources().map((url) => [url, this.textures.get(`gensrc:${url}`).getSourceImage() as CanvasImageSource]))
    this.textures.addCanvas(TERRAIN_GEN_TEXTURE, buildGeneratedTerrains(sources))

    for (const t of TERRAINS) {
      const tex = this.textures.get(terrainTexture(t))
      const img = tex.getSourceImage() as { width: number; height: number }
      const table = t.wang ?? t.fence
      if (table) {
        for (const list of Object.values(table)) {
          for (const [x, y] of list) if (!tex.has(wangFrame(x, y))) tex.add(wangFrame(x, y), 0, x, y, 32, 32)
        }
        continue
      }
      for (let n = 0; n < 21; n++) {
        const r = terrainFrameRect(t, n)
        // blocos LPC antigos têm 3×6 (sem os quadros 18–20)
        if (r.x + 32 <= img.width && r.y + 32 <= img.height) tex.add(terrainFrame(t.id, n), 0, r.x, r.y, 32, 32)
      }
    }
  }
}
