// ────────────────────────────────────────────────────────
// Ponto de entrada do motor do Vortable. Não conhece React, Supabase
// nem o Vorterium: quem usa (o harness de dev, depois a ponte no
// Vorterium) chama mountVortable() e passa os dados e os contratos.
//
//   mode 'play' → só o jogo, começando na zona inicial do mundo
//   mode 'edit' → editor de zonas, com botão Testar
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { WorldScene, type WorldSceneData } from './scenes/WorldScene'
import { EditorScene } from './editor/EditorScene'
import { EditorState } from './editor/EditorState'
import { EditorUI } from './editor/EditorUI'
import { LocalWorldStorage, type WorldStorage } from './storage'
import { newZone, type Appearance, type ZoneData } from './types'

import { CreatorUI } from './character/CreatorUI'
import { LocalCharacterStorage, type CharacterStorage } from './character/storage'

export * from './types'
export * from './storage'
export * from './character/storage'
export { TERRAINS } from './assets/terrains'
export { defaultAppearance, randomAppearance, loadCharacterData, normalizeAppearance } from './character/catalog'

export interface VortableOptions {
  mode?: 'play' | 'edit'
  /**
   * Zona inicial. No editor: a zona aberta (sem zona = uma nova vazia).
   * No jogo: onde começar (sem zona = a zona inicial do mundo).
   */
  zone?: ZoneData
  appearance: Appearance
  /** URL da pasta de assets (com / no fim). Padrão: './assets/'. */
  assetBase?: string
  /** Onde ficam o mundo e as zonas. Padrão: localStorage do navegador. */
  storage?: WorldStorage
  /** Editor: mostra o botão "Personagem" e chama isto ao clicar. */
  onEditCharacter?: () => void
}

export interface VortableHandle {
  setAppearance(appearance: Appearance): Promise<void>
  destroy(): void
}

export function mountVortable(parent: HTMLElement, opts: VortableOptions): VortableHandle {
  const assetBase = opts.assetBase ?? './assets/'
  const mode = opts.mode ?? 'play'
  const storage = opts.storage ?? new LocalWorldStorage()
  let appearance = opts.appearance

  let ui: EditorUI | null = null
  let state: EditorState | null = null
  let host = parent

  const worldData = (zone: ZoneData, loadZone: WorldSceneData['loadZone']): WorldSceneData => ({
    zone,
    appearance,
    assetBase,
    loadZone,
    onZone: (z) => ui?.showTestZone(z.name),
  })

  if (mode === 'edit') {
    state = new EditorState(opts.zone ?? newZone('Nova zona', 40, 30))
    ui = new EditorUI(parent, state, storage, {
      textureImage: (key) => game.textures.get(key).getSourceImage() as CanvasImageSource,
      startTest: () => {
        game.scene.stop('editor')
        // a zona aberta entra com as mudanças não salvas; as outras vêm do armazenamento
        const loadZone = async (id: string) => (id === state!.zone.id ? structuredClone(state!.zone) : storage.load(id))
        game.scene.start('world', worldData(structuredClone(state!.zone), loadZone))
      },
      stopTest: () => {
        game.scene.stop('world')
        game.scene.start('editor', { state })
      },
      deleteSelected: () => editor()?.deleteSelected(),
      centerOnZone: () => editor()?.centerOnZone(),
      editCharacter: opts.onEditCharacter,
    })
    host = ui.stage
  }

  /** Jogo: a zona dada, senão a inicial do mundo, senão a mais recente. */
  async function playStartZone(): Promise<ZoneData> {
    if (opts.zone) return opts.zone
    try {
      const world = await storage.loadWorld()
      const start = world.start && (await storage.load(world.start))
      if (start) return start
      const [recent] = await storage.list()
      const zone = recent && (await storage.load(recent.id))
      if (zone) return zone
    } catch (err) {
      console.error('[vortable] não deu pra ler o mundo', err)
    }
    return newZone('Vazio', 20, 15)
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    pixelArt: true,
    backgroundColor: '#07080c',
    // largura/altura de reserva: se o container ainda estiver escondido, o
    // WebGL quebra com tamanho 0
    scale: { mode: Phaser.Scale.RESIZE, width: host.clientWidth || 960, height: host.clientHeight || 640 },
    physics: { default: 'arcade', arcade: { debug: false } },
    input: { mouse: { preventDefaultWheel: true } },
  })
  game.scene.add('world', WorldScene)
  game.scene.add('editor', EditorScene)
  game.scene.add('boot', new BootScene(assetBase, async () => {
    game.scene.stop('boot')
    if (mode === 'edit') {
      game.scene.start('editor', { state })
      ui!.assetsReady()
    } else {
      game.scene.start('world', worldData(await playStartZone(), (id) => storage.load(id)))
    }
  }), true)

  // inspeção pelo console no desenvolvimento
  if (import.meta.env.DEV) (window as unknown as { __vortable: Phaser.Game }).__vortable = game

  const editor = () => (game.scene.isActive('editor') ? (game.scene.getScene('editor') as EditorScene) : null)

  return {
    async setAppearance(a) {
      appearance = a
      if (game.scene.isActive('world')) await (game.scene.getScene('world') as WorldScene).setAppearance(a)
    },
    destroy() {
      ui?.destroy()
      game.destroy(true)
    },
  }
}

export interface CreatorMountOptions {
  /** URL da pasta de assets (com / no fim). Padrão: './assets/'. */
  assetBase?: string
  /** Onde ficam os personagens. Padrão: localStorage do navegador. */
  storage?: CharacterStorage
  /** Botão de voltar (ex.: pro editor), opcional. */
  back?: { label: string; onClick: () => void }
}

/** Criador de personagem (não usa o Phaser: só DOM e canvas). */
export function mountCharacterCreator(parent: HTMLElement, opts: CreatorMountOptions = {}) {
  const ui = new CreatorUI(parent, {
    assetBase: opts.assetBase ?? './assets/',
    storage: opts.storage ?? new LocalCharacterStorage(),
    back: opts.back,
  })
  return { destroy: () => ui.destroy() }
}
