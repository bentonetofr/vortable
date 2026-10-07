// ────────────────────────────────────────────────────────
// Carrega a arte compartilhada (terrenos, catálogo e folhas de objetos)
// e registra os quadros nomeados. Depois avisa quem montou o jogo.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { GEN_SOURCES, TERRAIN_GEN_TEXTURE, TERRAIN_TEXTURE, TERRAIN_URL, TERRAINS, terrainFrame, terrainFrameRect, terrainTexture } from '../assets/terrains'
import { buildGeneratedTerrains } from '../assets/genTerrain'
import { CATALOG_URL, setObjectCatalog, sheetTexture, type ObjectCatalog } from '../assets/objects'

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
    for (const url of GEN_SOURCES) this.load.image(`gensrc:${url}`, this.assetBase + url)
  }

  /** Sem a arte básica não dá pra montar nada: mostra o que faltou e para. */
  private fail() {
    console.error('[vortable] arte não carregou:', this.failed)
    const lines = ['Não deu pra carregar a arte do Vortable:', ...this.failed, '', 'Confira a pasta de assets e recarregue.']
    this.status?.setText(lines.join('\n')).setColor('#ef4444')
  }

  create() {
    if (this.failed.length) return this.fail()

    // pisos e paredes de interior: montados agora a partir das texturas-fonte
    const sources = new Map(GEN_SOURCES.map((url) => [url, this.textures.get(`gensrc:${url}`).getSourceImage() as CanvasImageSource]))
    this.textures.addCanvas(TERRAIN_GEN_TEXTURE, buildGeneratedTerrains(sources))

    for (const t of TERRAINS) {
      const tex = this.textures.get(terrainTexture(t))
      for (let n = 0; n < 21; n++) {
        const r = terrainFrameRect(t, n)
        tex.add(terrainFrame(t.id, n), 0, r.x, r.y, 32, 32)
      }
    }

    const catalog = this.cache.json.get('catalog') as ObjectCatalog
    setObjectCatalog(catalog)
    for (const s of catalog.sheets) this.load.image(sheetTexture(s.id), this.assetBase + s.url)
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.failed.length) return this.fail()
      for (const o of catalog.objects) this.textures.get(sheetTexture(o.sheet)).add(o.id, 0, o.x, o.y, o.w, o.h)
      this.onReady()
    })
    this.load.start()
  }
}
