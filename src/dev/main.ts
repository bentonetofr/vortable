// Harness de desenvolvimento: roda o Vortable sozinho, sem o Vorterium.
//   /              → editor de zonas
//   /?personagem   → criador de personagem
//   /?jogar        → só o jogo, começando na zona inicial do mundo
//   /?assistir&rede → câmera do mestre (sem boneco) vendo quem está na rede
//   /?jogar&rede   → o jogo com rede de teste: abra em duas abas e elas se veem

import {
  LocalCharacterStorage, LocalWorldStorage, defaultAppearance, loadCharacterData, mountCharacterCreator, mountVortable,
  normalizeAppearance, randomAppearance, type Appearance, type NetLink, type ZoneData,
} from '../engine'
import { makeDemoZone } from './demoZone'

const assetBase = './assets/'
const params = new URLSearchParams(location.search)
const app = document.getElementById('app')!
const hud = document.getElementById('hud')!
const go = (query: string) => (location.search = query)

const worlds = new LocalWorldStorage()
const characters = new LocalCharacterStorage()

/** Aparência do personagem em uso (o último salvo no criador). */
async function activeAppearance(): Promise<Appearance> {
  try {
    const data = await loadCharacterData(assetBase)
    const [list, active] = await Promise.all([characters.list(), characters.getActive()])
    const chosen = list.find((c) => c.id === active) ?? list[0]
    return normalizeAppearance(data, chosen?.appearance ?? defaultAppearance())
  } catch (err) {
    // sem catálogo o jogo ainda abre; o boneco avisa que não carregou
    console.error('[vortable] personagem em uso não carregou', err)
    return defaultAppearance()
  }
}

/** Editor abre a última zona salva (ou a demonstração, na primeira vez). */
async function editorZone(): Promise<ZoneData> {
  const [last] = await worlds.list().catch(() => [])
  return (last && (await worlds.load(last.id))) || makeDemoZone()
}

/**
 * Teste de multiplayer sem o Vorterium: abra duas abas com ?jogar&rede (ou
 * ?rede=Nome) e as duas se veem — as mensagens vão por BroadcastChannel.
 */
function devNet(): NetLink | undefined {
  if (!params.has('rede')) return undefined
  const channel = new BroadcastChannel('vortable-teste')
  const selfId = crypto.randomUUID().slice(0, 8)
  channel.onmessage = (e) => vortable?.receive(e.data)
  return {
    selfId,
    name: params.get('rede') || `Jogador ${selfId.slice(0, 3)}`,
    send: (msg) => channel.postMessage(msg),
  }
}
let vortable: ReturnType<typeof mountVortable> | undefined

if (params.has('personagem')) {
  hud.hidden = true
  mountCharacterCreator(app, { assetBase, storage: characters, back: { label: 'Voltar ao editor', onClick: () => go('') } })
} else {
  const watching = params.has('assistir')
  const play = params.has('jogar') || watching
  hud.hidden = !play
  vortable = mountVortable(app, {
    mode: watching ? 'watch' : play ? 'play' : 'edit',
    zone: play ? undefined : await editorZone(),
    appearance: await activeAppearance(),
    assetBase,
    storage: worlds,
    onEditCharacter: () => go('?personagem'),
    curate: import.meta.env.DEV,
    net: play ? devNet() : undefined,
    // a câmera do mestre também ouve o som da zona (como no Controle do Vorterium)
    listen: watching,
  })

  if (import.meta.env.DEV) (window as unknown as { __handle?: unknown }).__handle = vortable

  // R sorteia uma aparência pra testar (não salva)
  window.addEventListener('keydown', async (e) => {
    const typing = (e.target as HTMLElement).matches('input, textarea, select')
    if (!typing && (e.key === 'r' || e.key === 'R')) vortable?.setAppearance(randomAppearance(await loadCharacterData(assetBase)))
  })
}
