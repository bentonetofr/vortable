// ────────────────────────────────────────────────────────
// Ponto de entrada do motor do Vortable. Não conhece React, Supabase
// nem o Vorterium: quem usa (o harness de dev, depois a ponte no
// Vorterium) chama mountVortable() e passa os dados.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { WorldScene, type WorldSceneData } from './scenes/WorldScene'
import type { Appearance, ZoneData } from './types'

export * from './types'
export { CHARACTER_SHEETS, OBJECTS, TERRAINS, PALETTES } from './assets/catalog'
export { paletteNames } from './character/compose'

export interface VortableOptions {
  zone: ZoneData
  appearance: Appearance
  /** URL da pasta de assets (com / no fim). Padrão: './assets/'. */
  assetBase?: string
}

export interface VortableHandle {
  setAppearance(appearance: Appearance): Promise<void>
  destroy(): void
}

export function mountVortable(parent: HTMLElement, opts: VortableOptions): VortableHandle {
  const data: WorldSceneData = {
    zone: opts.zone,
    appearance: opts.appearance,
    assetBase: opts.assetBase ?? './assets/',
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    backgroundColor: '#12100e',
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 960, height: parent.clientHeight || 640 },
    physics: { default: 'arcade', arcade: { debug: false } },
  })
  game.scene.add('world', WorldScene, true, data)

  const scene = () => game.scene.getScene('world') as WorldScene
  return {
    setAppearance: (a) => scene().setAppearance(a),
    destroy: () => game.destroy(true),
  }
}
