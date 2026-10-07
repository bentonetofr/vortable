// Harness de desenvolvimento: roda o Vortable sozinho, sem o Vorterium.
//   /              → editor de zonas
//   /?personagem   → criador de personagem
//   /?jogar        → só o jogo, começando na zona inicial do mundo

import {
  LocalCharacterStorage, LocalWorldStorage, defaultAppearance, loadCharacterData, mountCharacterCreator, mountVortable,
  normalizeAppearance, randomAppearance, type Appearance, type ZoneData,
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
  const data = await loadCharacterData(assetBase)
  const [list, active] = await Promise.all([characters.list(), characters.getActive()])
  const chosen = list.find((c) => c.id === active) ?? list[0]
  return normalizeAppearance(data, chosen?.appearance ?? defaultAppearance())
}

/** Editor abre a última zona salva (ou a demonstração, na primeira vez). */
async function editorZone(): Promise<ZoneData> {
  const [last] = await worlds.list().catch(() => [])
  return (last && (await worlds.load(last.id))) || makeDemoZone()
}

if (params.has('personagem')) {
  hud.hidden = true
  mountCharacterCreator(app, { assetBase, storage: characters, back: { label: 'Voltar ao editor', onClick: () => go('') } })
} else {
  const play = params.has('jogar')
  hud.hidden = !play
  const vortable = mountVortable(app, {
    mode: play ? 'play' : 'edit',
    zone: play ? undefined : await editorZone(),
    appearance: await activeAppearance(),
    assetBase,
    storage: worlds,
    onEditCharacter: () => go('?personagem'),
  })

  // R sorteia uma aparência pra testar (não salva)
  window.addEventListener('keydown', async (e) => {
    const typing = (e.target as HTMLElement).matches('input, textarea, select')
    if (!typing && (e.key === 'r' || e.key === 'R')) vortable.setAppearance(randomAppearance(await loadCharacterData(assetBase)))
  })
}
