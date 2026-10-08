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
import { newZone, type Appearance, type CharacterSave, type Dir, type WorldSky, type ZoneData } from './types'
import { setObjectCatalog, type ObjectCatalog } from './assets/objects'
import { registerObjectArt } from './world/objects'
import { formatHour, hourToCycle, skyOf, worldHour } from './world/daylight'
import { DAY_MINUTES } from './types'
import { AudioEngine, setAudioBase } from './audio/engine'
import { NetHub, type NetLink } from './net/hub'

import { CreatorUI } from './character/CreatorUI'
import { LocalCharacterStorage, type CharacterStorage } from './character/storage'

export * from './types'
export * from './storage'
export * from './character/storage'
export * from './character/transfer'
export { TERRAINS } from './assets/terrains'
export { composeFrame as characterFrame } from './character/compose'
export { defaultAppearance, randomAppearance, loadCharacterData, normalizeAppearance } from './character/catalog'

export { parseNet, REACTIONS } from './net/hub'
export type { NetLink, NetMsg, NetHello, NetState, NetAnim, NetEnv, NetReact } from './net/hub'
export { formatHour }
export { WEATHERS, WEATHER_ORDER } from './world/weather'
export { WIND_LEVELS, DEFAULT_WIND } from './world/wind'

export interface VortableOptions {
  /** play: jogar · edit: editor · watch: câmera livre do mestre (sem boneco; precisa de `net`). */
  mode?: 'play' | 'edit' | 'watch'
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
  /** Avisado a cada zona que a cena abre (o mestre acompanha em que zona a câmera está). */
  onZone?: (zone: ZoneData) => void
  /** Editor: mostra o botão "Personagem" e chama isto ao clicar. */
  onEditCharacter?: () => void
  /** Rede: com isto, os outros jogadores aparecem no mundo (sem, o jogo é solo). */
  net?: NetLink
  /** Volta de onde a pessoa parou (ver `VortableHandle.snapshot`). Vale pro mesmo `mode` em que foi tirado. */
  resume?: VortableSnapshot
  /** Câmera de observador: também ouve os sons da zona (espectador). */
  listen?: boolean
  /**
   * Editor: liga a curadoria de peças (gravar ajustes nos pack.json). Só
   * funciona com o servidor de desenvolvimento do Vortable (npm run dev).
   */
  curate?: boolean
}

const CURATE_URL = '/__vortable/curate'

/**
 * Onde a pessoa estava quando saiu (pra voltar exatamente aí): no jogo, a zona e o ponto
 * em que o boneco parou; no editor, a zona aberta (com o que ainda não foi salvo) e a câmera.
 */
export type VortableSnapshot =
  | { kind: 'play'; zoneId: string; x: number; y: number; dir: Dir }
  | { kind: 'edit'; zone: ZoneData; dirty: boolean; view: { x: number; y: number } | null; zoom: number }

/** Controles da câmera do mestre (mode 'watch'). */
export interface WatchControls {
  setZone(id: string): Promise<void>
  /** Enquadra a zona inteira. */
  fit(): void
  zoomBy(factor: number): void
  focus(x: number, y: number): void
  /** A câmera acompanha um jogador (null solta); `zoom` padrão 2 (o enquadramento do jogo). */
  follow(id: string | null, zoom?: number): void
  /** Quem a câmera acompanha agora (null = ninguém). */
  following(): string | null
  /** Espectador: manda uma reação (emoji de REACTIONS) pra todos verem no mapa. */
  react(emoji: string): void
  /** Quem está na sala e onde. */
  peers(): { id: string; name: string; zone: string | null; x: number; y: number }[]
  /** NPCs parados da zona que a câmera está vendo. */
  npcs(): { id: string; name: string; role: string }[]
  /** O NPC que o mestre controla agora (null = nenhum). */
  controllingNpc(): string | null
  /** Passa a controlar este NPC como um jogador (teclado WASD/setas, Shift corre). false = não deu. */
  controlNpc(id: string): Promise<boolean>
  /** Solta o NPC onde ele está: todos o veem parado ali, e o ponto fica guardado na zona. */
  releaseNpc(): Promise<void>
  /** Muda hora/tempo/vento ao vivo pra todos (zone '*' = todas as zonas; null = padrão da zona). */
  setEnv(env: { zone: string; hour: number | null; weather: string | null; wind: number | null }): void
  /** Ajuste que está valendo agora (pra a interface mostrar). */
  envs(): { zone: string; hour: number | null; weather: string | null; wind: number | null }[]
}

export interface VortableHandle {
  /** Só no mode 'watch'. */
  watch?: WatchControls
  /** Onde a pessoa está agora, pra `resume` na próxima vez (null = sem o que guardar). */
  snapshot(): VortableSnapshot | null
  /** Entrega uma mensagem que chegou da rede (ver NetMsg). */
  receive(msg: unknown): void
  /** A rede abriu depois do jogo: reanuncia o boneco e pergunta quem está na sala. */
  resync(): void
  /** O nome do jogador mudou (NetLink.name): os outros passam a ver o nome novo. */
  rename(): void
  setAppearance(appearance: Appearance): Promise<void>
  /** Trava o teclado do boneco (o mestre cobriu a tela com uma cena). */
  setInputLocked(locked: boolean): void
  destroy(): void
}

export function mountVortable(parent: HTMLElement, opts: VortableOptions): VortableHandle {
  const assetBase = opts.assetBase ?? './assets/'
  setAudioBase(assetBase)
  const mode = opts.mode ?? 'play'
  const storage = opts.storage ?? new LocalWorldStorage()
  let appearance = opts.appearance

  let inputLocked = false
  const hub = opts.net ? new NetHub(opts.net) : undefined
  let ui: EditorUI | null = null
  let state: EditorState | null = null
  let host = parent

  const worldData = (zone: ZoneData, loadZone: WorldSceneData['loadZone'], sky: WorldSky, timeOffset = 0, start?: { x: number; y: number; dir: Dir }): WorldSceneData => ({
    zone,
    ...(start ? { at: { x: start.x, y: start.y }, facing: start.dir } : {}),
    appearance,
    assetBase,
    loadZone,
    sky,
    timeOffset,
    onZone: (z) => { ui?.showTestZone(z.name); opts.onZone?.(z) },
    onClock: (hour) => ui?.showTestClock(hour),
    inputLocked: () => inputLocked,
    hub,
    watch: mode === 'watch',
    listen: opts.listen,
  })

  /**
   * Teste do editor numa zona em ciclo: o relógio começa na hora da prévia
   * (quem estava vendo a noite no editor testa à noite) e corre dali.
   */
  const previewOffset = (sky: WorldSky, hour: number) => {
    const day = (sky.dayMinutes ?? DAY_MINUTES) * 60_000
    const now = Date.now()
    const diff = (((hourToCycle(hour) - hourToCycle(worldHour(sky.dayMinutes, now))) % 1) + 1) % 1
    return diff * day
  }

  if (mode === 'edit') {
    const back = opts.resume?.kind === 'edit' ? opts.resume : null
    state = new EditorState(back ? back.zone : opts.zone ?? newZone('Nova zona', 40, 30))
    state.assetBase = assetBase
    // voltando: a zona vem como estava (inclusive o que não foi salvo) e a câmera no mesmo lugar
    if (back) { state.dirty = back.dirty; state.view = back.view; state.zoom = back.zoom }
    ui = new EditorUI(parent, state, storage, {
      assetBase,
      textureImage: (key) => game.textures.get(key).getSourceImage() as CanvasImageSource,
      startTest: () => {
        game.scene.stop('editor')
        // a zona aberta entra com as mudanças não salvas; as outras vêm do armazenamento
        const loadZone = async (id: string) => (id === state!.zone.id ? structuredClone(state!.zone) : storage.load(id))
        const sky = skyOf(state!.world)
        game.scene.start('world', worldData(structuredClone(state!.zone), loadZone, sky, previewOffset(sky, state!.previewHour)))
      },
      stopTest: () => {
        game.scene.stop('world')
        game.scene.start('editor', { state })
      },
      deleteSelected: () => editor()?.deleteSelected(),
      applySound: () => {
        const scene = game.scene.getScenes(true)[0]
        if (scene) AudioEngine.of(scene)?.applyPrefs()
      },
      centerOnZone: () => editor()?.centerOnZone(),
      scene: () => editor(),
      editCharacter: opts.onEditCharacter,
      curate: opts.curate
        ? async (pack, id, override) => {
          const res = await fetch(CURATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pack, id, override }),
          })
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
          setObjectCatalog(body as ObjectCatalog)
          registerObjectArt(game, body as ObjectCatalog)
          state!.emit('catalog')
        }
        : undefined,
    })
    host = ui.stage
  }

  /** Jogo: a zona dada, senão a inicial do mundo, senão a mais recente; e a hora/tempo do mundo. */
  async function playStart(): Promise<{ zone: ZoneData; sky: WorldSky; start?: { x: number; y: number; dir: Dir } }> {
    let sky = skyOf(null)
    try {
      const world = await storage.loadWorld()
      sky = skyOf(world)
      // voltando de onde parou: a mesma zona, no mesmo ponto (se a zona ainda existe)
      if (opts.resume?.kind === 'play') {
        const back = opts.resume
        const zone = await storage.load(back.zoneId)
        if (zone && back.x >= 0 && back.y >= 0 && back.x <= zone.width * 32 && back.y <= zone.height * 32) return { zone, sky, start: { x: back.x, y: back.y, dir: back.dir } }
      }
      if (opts.zone) return { zone: opts.zone, sky }
      const start = world.start && (await storage.load(world.start))
      if (start) return { zone: start, sky }
      const [recent] = await storage.list()
      const zone = recent && (await storage.load(recent.id))
      if (zone) return { zone, sky }
    } catch (err) {
      console.error('[vortable] não deu pra ler o mundo', err)
    }
    if (opts.zone) return { zone: opts.zone, sky }
    // id fixo: sem nenhuma zona salva, todos (e a rede) caem na mesma zona vazia
    return { zone: { ...newZone('Vazio', 20, 15), id: 'vazio' }, sky }
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
      const { zone, sky, start } = await playStart()
      game.scene.start('world', worldData(zone, (id) => storage.load(id), sky, 0, start))
    }
  }), true)

  // inspeção pelo console no desenvolvimento
  if (import.meta.env.DEV) (window as unknown as { __vortable: Phaser.Game }).__vortable = game

  const world = () => (game.scene.isActive('world') ? (game.scene.getScene('world') as WorldScene) : null)
  const editor = () => (game.scene.isActive('editor') ? (game.scene.getScene('editor') as EditorScene) : null)

  /** Guarda o ponto onde o mestre largou o NPC (relê a zona do banco, pra não passar por cima de edições). */
  const persistNpc = async (r: { id: string; zone: string; x: number; y: number; dir: Dir }) => {
    const z = await storage.load(r.zone)
    const n = z?.npcs?.find((x) => x.id === r.id)
    if (!z || !n) return
    n.x = r.x; n.y = r.y; n.dir = r.dir
    await storage.save(z)
  }

  const watch: WatchControls | undefined = mode === 'watch'
    ? {
      setZone: async (id) => { await world()?.releaseNpc(persistNpc); await world()?.watchZone(id) },
      npcs: () => world()?.watchNpcs() ?? [],
      controllingNpc: () => world()?.controllingNpc() ?? null,
      controlNpc: async (id) => (await world()?.controlNpc(id)) ?? false,
      releaseNpc: async () => { await world()?.releaseNpc(persistNpc) },
      fit: () => world()?.watchFit(),
      zoomBy: (f) => world()?.watchZoom(f),
      focus: (x, y) => world()?.watchFocus(x, y),
      follow: (id, zoom) => world()?.watchFollow(id, zoom),
      following: () => world()?.watchFollowing() ?? null,
      react: (emoji) => world()?.watchReact(emoji),
      peers: () => world()?.watchPeers() ?? [],
      setEnv: (env) => hub?.setEnv(env),
      envs: () => [...(hub?.envs.values() ?? [])].map(({ zone, hour, weather, wind }) => ({ zone, hour, weather, wind })),
    }
    : undefined

  return {
    watch,
    snapshot() {
      if (mode === 'edit') {
        if (!state) return null
        const cam = editor()?.cameras.main
        return {
          kind: 'edit',
          zone: structuredClone(state.zone),
          dirty: state.dirty,
          view: cam ? { x: Math.round(cam.midPoint.x), y: Math.round(cam.midPoint.y) } : state.view,
          zoom: cam?.zoom ?? state.zoom,
        }
      }
      if (mode === 'play') {
        const at = world()?.snapshotPlay()
        return at ? { kind: 'play', ...at } : null
      }
      return null
    },
    async setAppearance(a) {
      appearance = a
      if (game.scene.isActive('world')) await (game.scene.getScene('world') as WorldScene).setAppearance(a)
    },
    receive(msg) {
      hub?.receive(msg)
    },
    resync() {
      hub?.resync()
    },
    rename() {
      hub?.rename()
    },
    setInputLocked(locked) {
      inputLocked = locked
      if (game.scene.isActive('world')) (game.scene.getScene('world') as WorldScene).setInputLocked(locked)
    },
    destroy() {
      // NPC controlado: fica onde está (o ponto é guardado em segundo plano)
      if (mode === 'watch') void world()?.releaseNpc(persistNpc)
      hub?.leave()
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
  /** Modo jogador (um boneco só). Ver CreatorOptions. */
  single?: boolean
  saveLabel?: string
  activateOnSave?: boolean
  onSaved?: (c: CharacterSave) => void
}

/** Criador de personagem (não usa o Phaser: só DOM e canvas). */
export function mountCharacterCreator(parent: HTMLElement, opts: CreatorMountOptions = {}) {
  const ui = new CreatorUI(parent, {
    assetBase: opts.assetBase ?? './assets/',
    storage: opts.storage ?? new LocalCharacterStorage(),
    back: opts.back,
    single: opts.single,
    saveLabel: opts.saveLabel,
    activateOnSave: opts.activateOnSave,
    onSaved: opts.onSaved,
  })
  return { destroy: () => ui.destroy() }
}
