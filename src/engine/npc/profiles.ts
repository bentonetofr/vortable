// ────────────────────────────────────────────────────────
// Estilos de NPC por tipo de lugar: cada ocupação diz que peças de roupa, que
// cores e que tipo de cabelo combinam com ela. O gerador (generate.ts) sorteia
// dentro disso, então duas pessoas da mesma ocupação não ficam iguais.
// As peças são achadas no catálogo do personagem por um regex no id.
// ────────────────────────────────────────────────────────

import type { ProfileId } from './analyze'

/** Uma peça possível num espaço: regex do id no catálogo, cores que combinam e a chance de usar. */
export interface SlotSpec {
  re: RegExp
  colors?: string[]
  chance?: number
}

export type HairStyle = 'neat' | 'rustic' | 'short' | 'elder'

/** Idade do rosto: adulto (padrão) ou idoso. */
export type Age = 'adult' | 'elder' | 'any'

export interface Outfit {
  clothes?: SlotSpec[]
  vest?: SlotSpec[]
  jacket?: SlotSpec[]
  dress?: SlotSpec[]
  legs?: SlotSpec[]
  shoes?: SlotSpec[]
  hat?: SlotSpec[]
  neck?: SlotSpec[]
  cape?: SlotSpec[]
  apron?: SlotSpec[]
  belt?: SlotSpec[]
  armour?: SlotSpec[]
  gloves?: SlotSpec[]
  arms?: SlotSpec[]
  backpack?: SlotSpec[]
  facial?: SlotSpec[]
  hair: HairStyle
  age?: Age
  /** Chance de barba/bigode (só corpo masculino). */
  beard?: number
}

export interface Role {
  /** [masculino, feminino]. */
  label: [string, string]
  weight: number
  outfit: Outfit
}

// ── cores de roupa (nomes da paleta "cloth"; as nossas: midnight, oxblood, pale_gray, espresso, steel_blue) ──
const MUTED = ['gray', 'slate', 'bluegray', 'brown', 'walnut', 'tan', 'forest', 'navy', 'charcoal', 'leather', 'steel_blue']
const RICH = ['maroon', 'purple', 'navy', 'forest', 'teal', 'black', 'midnight', 'oxblood', 'steel_blue', 'rose']
const RUSTIC = ['brown', 'tan', 'walnut', 'leather', 'forest', 'green', 'gray', 'yellow', 'espresso', 'orange']
const LIGHT = ['white', 'pale_gray', 'sky', 'tan', 'yellow', 'rose']
const DARK = ['black', 'charcoal', 'midnight', 'espresso', 'navy', 'oxblood', 'gray']
const WARM = ['red', 'orange', 'yellow', 'maroon', 'tan', 'brown', 'forest', 'teal']
const STEEL = ['gray', 'charcoal', 'slate', 'white']
const CLOAK = ['maroon', 'navy', 'forest', 'black', 'brown', 'gray', 'midnight']

const s = (re: RegExp, colors?: string[], chance = 1): SlotSpec => ({ re, colors, chance })

// ── peças ──
const LONG = /shirts\/longsleeve\//
const BLOUSE = /torso_clothes_blouse/
const SHORT = /shirts\/shortsleeve\//
const SLEEVELESS = /shirts\/sleeveless\//
const ROBE = /torso_clothes_(robe|tunic)\b/
const VEST = /torso_clothes_(vest|corset)/
const FROCK = /jacket_(frock|collared)/
const TABARD = /jacket_tabard/
const PANTS = /legs\/pants\/legs_(pants|pants2|formal|cuffed|pantaloons)/
const PANTS_PLAIN = /legs\/pants\/legs_(pants|pants2|cuffed)/
const SKIRT = /skirts\/legs_(skirts_plain|skirt_straight|skirt_belle)/
const SHOES = /feet\/shoes\/feet_shoes_(basic|revised|ghillies)/
const BOOTS = /feet\/boots\/feet_boots_(basic|revised|rim|fold)/
const FORMAL_HAT = /hat_formal_(tophat|bowler)/
const CAP = /hat_cap_(leather|bonnie)/
const HOOD = /hat_hood_cloth/
const GUARD_HELM = /hat_helmet_(legion|kettle|nasal|norman|morion|spangenhelm|flattop)/
const NECK_FORMAL = /neck_(cravat|jabot|bowtie|bowtie2|necktie)/
const SCARF = /neck_scarf/
const BELT = /belt_(leather|double|loose|leather2)/
const APRON = /torso_aprons_apron(_full|_half)?$/
const CAPE = /cape_solid/
const GLASSES = /facial_glasses(_halfmoon|_round|_secretary|_nerd)?$/
const GLOVES = /arms_gloves/
const OVERALLS = /torso_aprons_(overalls|suspenders)/

const ARMOUR = /armour\/torso_armour_(leather|legion|plate)|torso_chainmail/
const LEATHER_ARMOUR = /torso_armour_leather/

/** As ocupações de cada tipo de lugar. */
export const PROFILES: Record<ProfileId, Role[]> = {
  biblioteca: [
    { label: ['Bibliotecário', 'Bibliotecária'], weight: 3, outfit: {
      clothes: [s(LONG, ['navy', 'slate', 'bluegray', 'gray', 'forest', 'maroon', 'white']), s(BLOUSE, ['navy', 'slate', 'white', 'forest', 'maroon'])],
      vest: [s(VEST, ['black', 'navy', 'maroon', 'forest', 'gray'], 0.45)],
      legs: [s(PANTS, DARK), s(SKIRT, DARK, 0.5)], shoes: [s(SHOES, DARK)], neck: [s(NECK_FORMAL, ['midnight', 'steel_blue', 'white', 'maroon'], 0.6)],
      facial: [s(GLASSES, undefined, 0.55)], hair: 'neat', beard: 0.2 } },
    { label: ['Estudioso', 'Estudiosa'], weight: 3, outfit: {
      clothes: [s(ROBE, RUSTIC.slice(0, 6)), s(LONG, MUTED), s(BLOUSE, MUTED)],
      belt: [s(BELT, ['brown', 'leather', 'walnut'], 0.5)], legs: [s(PANTS_PLAIN, DARK), s(SKIRT, DARK, 0.4)],
      shoes: [s(SHOES, DARK), s(BOOTS, ['brown', 'espresso'])], facial: [s(GLASSES, undefined, 0.35)], hair: 'rustic', beard: 0.25 } },
    { label: ['Nobre', 'Nobre'], weight: 2, outfit: {
      jacket: [s(FROCK, RICH, 0.9)], dress: [s(/dress_(sash|slit)/, RICH, 0.7)],
      clothes: [s(LONG, LIGHT), s(BLOUSE, LIGHT)], neck: [s(NECK_FORMAL, ['white', 'maroon', 'steel_blue'], 0.7)],
      legs: [s(PANTS, DARK)], shoes: [s(BOOTS, ['black', 'espresso', 'brown']), s(SHOES, DARK)],
      hat: [s(FORMAL_HAT, DARK, 0.22)], gloves: [s(GLOVES, ['white', 'black'], 0.2)], hair: 'neat', beard: 0.3 } },
    { label: ['Guarda do palácio', 'Guarda do palácio'], weight: 2, outfit: {
      armour: [s(ARMOUR, STEEL)], hat: [s(GUARD_HELM, STEEL)], cape: [s(CAPE, ['maroon', 'navy', 'black'], 0.6)],
      legs: [s(PANTS_PLAIN, ['charcoal', 'gray', 'black', 'navy'])], shoes: [s(BOOTS, ['black', 'espresso'])], gloves: [s(GLOVES, ['black', 'gray'], 0.5)],
      hair: 'short', beard: 0.3 } },
    { label: ['Criado', 'Criada'], weight: 2, outfit: {
      clothes: [s(BLOUSE, LIGHT), s(LONG, LIGHT)], apron: [s(APRON, ['white', 'pale_gray', 'tan'])],
      legs: [s(PANTS_PLAIN, ['charcoal', 'brown', 'black']), s(SKIRT, ['charcoal', 'brown', 'black'], 0.6)], shoes: [s(SHOES, DARK)], hair: 'neat' } },
  ],
  taverna: [
    { label: ['Taverneiro', 'Taverneira'], weight: 3, outfit: {
      clothes: [s(SHORT, ['tan', 'white', 'brown']), s(LONG, ['tan', 'white', 'brown'])], apron: [s(APRON, ['white', 'tan', 'brown'])],
      legs: [s(PANTS_PLAIN, DARK)], shoes: [s(SHOES, DARK)], hair: 'rustic', beard: 0.5 } },
    { label: ['Cliente', 'Cliente'], weight: 4, outfit: {
      clothes: [s(LONG, WARM), s(SHORT, WARM), s(BLOUSE, WARM)], vest: [s(VEST, RUSTIC, 0.3)], legs: [s(PANTS_PLAIN, DARK), s(SKIRT, DARK, 0.3)],
      shoes: [s(SHOES, DARK), s(BOOTS, ['brown', 'espresso'])], hat: [s(CAP, RUSTIC, 0.2)], hair: 'rustic', beard: 0.4 } },
    { label: ['Bardo', 'Bardo'], weight: 2, outfit: {
      clothes: [s(BLOUSE, ['red', 'teal', 'purple', 'yellow', 'white']), s(LONG, ['red', 'teal', 'purple', 'orange'])],
      vest: [s(VEST, RICH, 0.7)], legs: [s(PANTS, DARK)], shoes: [s(BOOTS, ['brown', 'espresso', 'black'])],
      hat: [s(CAP, ['red', 'green', 'teal', 'brown'], 0.5)], hair: 'rustic', beard: 0.25 } },
    { label: ['Garçom', 'Garçonete'], weight: 2, outfit: {
      clothes: [s(BLOUSE, ['white', 'pale_gray']), s(LONG, ['white', 'pale_gray'])], apron: [s(APRON, ['white', 'black', 'charcoal'])],
      legs: [s(PANTS_PLAIN, ['black', 'charcoal']), s(SKIRT, ['black', 'charcoal'], 0.6)], shoes: [s(SHOES, DARK)], hair: 'neat' } },
    { label: ['Viajante', 'Viajante'], weight: 2, outfit: {
      clothes: [s(LONG, RUSTIC), s(SHORT, RUSTIC)], cape: [s(CAPE, CLOAK, 0.7)], hat: [s(HOOD, CLOAK, 0.3)],
      legs: [s(PANTS_PLAIN, DARK)], shoes: [s(BOOTS, ['brown', 'espresso'])], backpack: [s(/backpack\/backpack$/, undefined, 0.6)], hair: 'rustic', beard: 0.4 } },
  ],
  vila: [
    { label: ['Camponês', 'Camponesa'], weight: 3, outfit: {
      clothes: [s(LONG, RUSTIC), s(SHORT, RUSTIC), s(BLOUSE, RUSTIC)], apron: [s(OVERALLS, ['brown', 'tan', 'forest'], 0.3)],
      legs: [s(PANTS_PLAIN, DARK), s(SKIRT, RUSTIC, 0.45)], shoes: [s(SHOES, ['brown', 'espresso']), s(BOOTS, ['brown'])],
      hat: [s(CAP, RUSTIC, 0.3)], hair: 'rustic', beard: 0.35 } },
    { label: ['Ferreiro', 'Ferreira'], weight: 2, outfit: {
      clothes: [s(SLEEVELESS, DARK), s(SHORT, DARK)], apron: [s(APRON, ['leather', 'brown', 'charcoal'])], gloves: [s(GLOVES, ['black', 'brown'], 0.7)],
      legs: [s(PANTS_PLAIN, ['charcoal', 'brown', 'black'])], shoes: [s(BOOTS, ['black', 'espresso'])], hair: 'short', beard: 0.55 } },
    { label: ['Padeiro', 'Padeira'], weight: 2, outfit: {
      clothes: [s(SHORT, LIGHT), s(BLOUSE, LIGHT)], apron: [s(APRON, ['white', 'pale_gray'])], legs: [s(PANTS_PLAIN, ['tan', 'gray', 'brown']), s(SKIRT, ['tan', 'gray'], 0.5)],
      shoes: [s(SHOES, ['brown', 'espresso'])], hair: 'neat', beard: 0.2 } },
    { label: ['Guarda da vila', 'Guarda da vila'], weight: 2, outfit: {
      armour: [s(LEATHER_ARMOUR, ['brown', 'leather', 'walnut'])], hat: [s(GUARD_HELM, STEEL, 0.8)], legs: [s(PANTS_PLAIN, ['brown', 'charcoal', 'navy'])],
      shoes: [s(BOOTS, ['brown', 'espresso', 'black'])], cape: [s(CAPE, ['green', 'forest', 'navy', 'maroon'], 0.4)], hair: 'short', beard: 0.35 } },
    { label: ['Morador', 'Moradora'], weight: 4, outfit: {
      clothes: [s(LONG, WARM), s(SHORT, WARM), s(BLOUSE, WARM)], vest: [s(VEST, RUSTIC, 0.25)], legs: [s(PANTS_PLAIN, DARK), s(SKIRT, DARK, 0.5)],
      shoes: [s(SHOES, DARK), s(BOOTS, ['brown'])], hair: 'rustic', beard: 0.3 } },
    { label: ['Mercador', 'Mercadora'], weight: 2, outfit: {
      clothes: [s(LONG, RICH), s(BLOUSE, RICH)], vest: [s(VEST, ['black', 'maroon', 'forest', 'navy'], 0.6)], belt: [s(BELT, ['brown', 'leather'], 0.6)],
      legs: [s(PANTS, DARK)], shoes: [s(BOOTS, ['brown', 'espresso'])], hat: [s(CAP, RICH, 0.35)], hair: 'neat', beard: 0.35 } },
  ],
  mercado: [
    { label: ['Mercador', 'Mercadora'], weight: 4, outfit: {
      clothes: [s(LONG, RICH), s(BLOUSE, WARM)], vest: [s(VEST, ['black', 'maroon', 'forest', 'navy'], 0.6)], apron: [s(APRON, LIGHT, 0.3)], belt: [s(BELT, ['brown', 'leather'], 0.6)],
      legs: [s(PANTS, DARK), s(SKIRT, DARK, 0.4)], shoes: [s(SHOES, DARK), s(BOOTS, ['brown'])], hat: [s(CAP, RICH, 0.35)], hair: 'rustic', beard: 0.35 } },
    { label: ['Freguês', 'Freguesa'], weight: 4, outfit: {
      clothes: [s(LONG, WARM), s(SHORT, WARM), s(BLOUSE, WARM)], legs: [s(PANTS_PLAIN, DARK), s(SKIRT, DARK, 0.5)], shoes: [s(SHOES, DARK)],
      hat: [s(CAP, RUSTIC, 0.15)], backpack: [s(/backpack_basket/, undefined, 0.3)], hair: 'rustic', beard: 0.3 } },
    { label: ['Artesão', 'Artesã'], weight: 2, outfit: {
      clothes: [s(SHORT, RUSTIC), s(SLEEVELESS, RUSTIC)], apron: [s(APRON, ['leather', 'brown', 'tan'])], gloves: [s(GLOVES, ['brown'], 0.3)],
      legs: [s(PANTS_PLAIN, ['brown', 'charcoal'])], shoes: [s(BOOTS, ['brown'])], hair: 'short', beard: 0.4 } },
    { label: ['Guarda', 'Guarda'], weight: 2, outfit: {
      armour: [s(LEATHER_ARMOUR, ['brown', 'leather'])], hat: [s(GUARD_HELM, STEEL, 0.8)], legs: [s(PANTS_PLAIN, ['charcoal', 'brown', 'navy'])],
      shoes: [s(BOOTS, ['black', 'espresso'])], hair: 'short', beard: 0.3 } },
  ],
  fazenda: [
    { label: ['Fazendeiro', 'Fazendeira'], weight: 4, outfit: {
      clothes: [s(LONG, ['tan', 'white', 'brown', 'yellow', 'gray']), s(SHORT, ['tan', 'white', 'yellow'])], apron: [s(OVERALLS, ['brown', 'navy', 'forest', 'tan'], 0.7)],
      legs: [s(PANTS_PLAIN, ['brown', 'tan', 'navy'])], shoes: [s(BOOTS, ['brown', 'espresso'])], hat: [s(CAP, ['tan', 'brown', 'yellow'], 0.6)], hair: 'rustic', beard: 0.45 } },
    { label: ['Peão', 'Peã'], weight: 3, outfit: {
      clothes: [s(SHORT, RUSTIC), s(SLEEVELESS, RUSTIC)], legs: [s(PANTS_PLAIN, ['brown', 'tan', 'charcoal'])], shoes: [s(BOOTS, ['brown']), s(SHOES, ['brown'])],
      hat: [s(CAP, ['tan', 'brown'], 0.5)], hair: 'short', beard: 0.4 } },
    { label: ['Pastor', 'Pastora'], weight: 2, outfit: {
      clothes: [s(LONG, ['brown', 'tan', 'gray', 'forest'])], cape: [s(CAPE, ['brown', 'forest', 'gray'], 0.6)], hat: [s(HOOD, ['brown', 'forest'], 0.3)],
      legs: [s(PANTS_PLAIN, ['brown', 'charcoal'])], shoes: [s(BOOTS, ['brown', 'espresso'])], hair: 'rustic', beard: 0.4 } },
    { label: ['Cozinheiro', 'Cozinheira'], weight: 1, outfit: {
      clothes: [s(BLOUSE, LIGHT), s(SHORT, LIGHT)], apron: [s(APRON, ['white', 'pale_gray'])], legs: [s(PANTS_PLAIN, ['brown', 'gray']), s(SKIRT, ['brown', 'gray'], 0.5)],
      shoes: [s(SHOES, DARK)], hair: 'neat' } },
  ],
  floresta: [
    { label: ['Caçador', 'Caçadora'], weight: 3, outfit: {
      clothes: [s(LONG, ['brown', 'forest', 'green', 'tan', 'walnut']), s(SHORT, ['brown', 'forest', 'tan'])], vest: [s(VEST, ['leather', 'brown', 'forest'], 0.5)],
      cape: [s(CAPE, ['forest', 'brown', 'green'], 0.5)], hat: [s(HOOD, ['forest', 'brown'], 0.4), s(CAP, ['brown', 'forest'], 0.2)], belt: [s(BELT, ['brown', 'leather'], 0.7)],
      legs: [s(PANTS_PLAIN, ['brown', 'forest', 'charcoal'])], shoes: [s(BOOTS, ['brown', 'espresso'])], backpack: [s(/backpack\/backpack$/, undefined, 0.4)], hair: 'rustic', beard: 0.5 } },
    { label: ['Andarilho', 'Andarilha'], weight: 3, outfit: {
      clothes: [s(LONG, RUSTIC)], cape: [s(CAPE, CLOAK)], hat: [s(HOOD, CLOAK, 0.5)], legs: [s(PANTS_PLAIN, DARK)], shoes: [s(BOOTS, ['brown', 'espresso'])],
      backpack: [s(/backpack\/backpack/, undefined, 0.5)], hair: 'rustic', beard: 0.5 } },
    { label: ['Ervanário', 'Ervanária'], weight: 2, outfit: {
      clothes: [s(ROBE, ['forest', 'green', 'tan', 'brown']), s(BLOUSE, ['green', 'forest', 'white'])], belt: [s(BELT, ['brown', 'leather'], 0.6)],
      legs: [s(PANTS_PLAIN, ['brown', 'forest']), s(SKIRT, ['brown', 'forest'], 0.5)], shoes: [s(SHOES, ['brown']), s(BOOTS, ['brown'])],
      backpack: [s(/backpack_basket/, undefined, 0.6)], hair: 'rustic', age: 'any', beard: 0.35 } },
    { label: ['Batedor', 'Batedora'], weight: 2, outfit: {
      armour: [s(LEATHER_ARMOUR, ['brown', 'leather', 'forest'])], hat: [s(CAP, ['brown', 'forest'], 0.6)], cape: [s(CAPE, ['forest', 'green'], 0.5)],
      legs: [s(PANTS_PLAIN, ['brown', 'forest', 'charcoal'])], shoes: [s(BOOTS, ['brown', 'espresso'])], gloves: [s(GLOVES, ['brown'], 0.5)], hair: 'short', beard: 0.35 } },
  ],
  cemiterio: [
    { label: ['Coveiro', 'Coveira'], weight: 3, outfit: {
      clothes: [s(LONG, ['charcoal', 'gray', 'brown', 'black']), s(SHORT, ['charcoal', 'gray'])], vest: [s(VEST, ['black', 'charcoal'], 0.4)],
      hat: [s(CAP, ['black', 'charcoal', 'brown'], 0.4)], legs: [s(PANTS_PLAIN, ['black', 'charcoal'])], shoes: [s(BOOTS, ['black', 'espresso'])], hair: 'short', beard: 0.5 } },
    { label: ['Sacerdote', 'Sacerdotisa'], weight: 3, outfit: {
      clothes: [s(ROBE, ['black', 'white', 'pale_gray', 'midnight', 'oxblood'])], hat: [s(HOOD, ['black', 'midnight', 'white'], 0.4)], belt: [s(BELT, ['brown', 'leather'], 0.4)],
      legs: [s(PANTS_PLAIN, ['black', 'charcoal'])], shoes: [s(SHOES, DARK)], hair: 'neat', age: 'any', beard: 0.35 } },
    { label: ['Enlutado', 'Enlutada'], weight: 3, outfit: {
      jacket: [s(FROCK, ['black', 'charcoal', 'midnight'], 0.4)], dress: [s(/dress_(sash|slit)/, ['black', 'charcoal'], 0.6)],
      clothes: [s(LONG, ['black', 'charcoal']), s(BLOUSE, ['black', 'charcoal'])], legs: [s(PANTS, ['black', 'charcoal']), s(SKIRT, ['black'], 0.5)],
      shoes: [s(SHOES, ['black']), s(BOOTS, ['black'])], hat: [s(FORMAL_HAT, ['black'], 0.2)], hair: 'neat', age: 'any', beard: 0.2 } },
    { label: ['Vigia', 'Vigia'], weight: 1, outfit: {
      clothes: [s(LONG, ['charcoal', 'gray'])], cape: [s(CAPE, ['black', 'charcoal', 'midnight'])], hat: [s(HOOD, ['black', 'charcoal'], 0.5)],
      legs: [s(PANTS_PLAIN, ['black', 'charcoal'])], shoes: [s(BOOTS, ['black', 'espresso'])], hair: 'short', beard: 0.4 } },
  ],
  masmorra: [
    { label: ['Guarda', 'Guarda'], weight: 4, outfit: {
      armour: [s(ARMOUR, STEEL)], hat: [s(GUARD_HELM, STEEL)], legs: [s(PANTS_PLAIN, ['charcoal', 'black', 'gray'])], shoes: [s(BOOTS, ['black', 'espresso'])],
      gloves: [s(GLOVES, ['black', 'gray'], 0.6)], cape: [s(CAPE, ['black', 'charcoal'], 0.3)], hair: 'short', beard: 0.4 } },
    { label: ['Carcereiro', 'Carcereira'], weight: 2, outfit: {
      clothes: [s(SLEEVELESS, DARK), s(SHORT, DARK)], vest: [s(VEST, ['leather', 'brown', 'black'], 0.8)], belt: [s(BELT, ['brown', 'leather', 'charcoal'])],
      gloves: [s(GLOVES, ['black', 'brown'], 0.6)], legs: [s(PANTS_PLAIN, ['charcoal', 'brown'])], shoes: [s(BOOTS, ['black', 'espresso'])], hair: 'short', beard: 0.55 } },
    { label: ['Prisioneiro', 'Prisioneira'], weight: 2, outfit: {
      clothes: [s(SLEEVELESS, ['gray', 'tan', 'brown', 'pale_gray']), s(SHORT, ['gray', 'tan', 'brown'])], legs: [s(PANTS_PLAIN, ['gray', 'brown', 'tan'])],
      shoes: [s(/feet_sandals|feet_slippers|feet_shoes_basic/, ['brown', 'gray'], 0.7)], hair: 'rustic', beard: 0.6 } },
    { label: ['Aventureiro', 'Aventureira'], weight: 2, outfit: {
      armour: [s(LEATHER_ARMOUR, ['brown', 'leather', 'charcoal'])], cape: [s(CAPE, CLOAK, 0.6)], backpack: [s(/backpack\/backpack/, undefined, 0.6)],
      legs: [s(PANTS_PLAIN, ['brown', 'charcoal'])], shoes: [s(BOOTS, ['brown', 'espresso'])], belt: [s(BELT, ['brown', 'leather'], 0.5)], hair: 'rustic', beard: 0.4 } },
  ],
  neve: [
    { label: ['Montanhês', 'Montanhesa'], weight: 3, outfit: {
      clothes: [s(LONG, ['brown', 'gray', 'tan', 'forest', 'navy'])], cape: [s(CAPE, ['brown', 'gray', 'forest', 'navy'], 0.8)], hat: [s(HOOD, ['brown', 'gray', 'forest'], 0.7)],
      neck: [s(SCARF, ['red', 'maroon', 'gray', 'forest'], 0.7)], legs: [s(PANTS_PLAIN, ['brown', 'charcoal', 'navy'])], shoes: [s(BOOTS, ['brown', 'espresso'])],
      gloves: [s(GLOVES, ['brown', 'gray'], 0.7)], hair: 'rustic', beard: 0.6 } },
    { label: ['Caçador', 'Caçadora'], weight: 2, outfit: {
      clothes: [s(LONG, ['brown', 'tan', 'gray'])], vest: [s(VEST, ['leather', 'brown'], 0.6)], cape: [s(CAPE, ['brown', 'gray'], 0.6)], hat: [s(HOOD, ['brown', 'gray'], 0.6)],
      legs: [s(PANTS_PLAIN, ['brown', 'charcoal'])], shoes: [s(BOOTS, ['brown', 'espresso'])], gloves: [s(GLOVES, ['brown'], 0.6)], backpack: [s(/backpack\/backpack$/, undefined, 0.4)],
      hair: 'rustic', beard: 0.5 } },
    { label: ['Viajante agasalhado', 'Viajante agasalhada'], weight: 3, outfit: {
      jacket: [s(TABARD, ['navy', 'maroon', 'forest', 'gray', 'brown'], 0.8)], clothes: [s(LONG, ['white', 'tan', 'gray'])], neck: [s(SCARF, ['red', 'teal', 'yellow', 'maroon'], 0.8)],
      hat: [s(HOOD, ['gray', 'brown', 'navy'], 0.5)], legs: [s(PANTS_PLAIN, ['charcoal', 'brown', 'navy'])], shoes: [s(BOOTS, ['brown', 'black'])], gloves: [s(GLOVES, ['brown', 'gray'], 0.6)],
      hair: 'rustic', beard: 0.4 } },
  ],
  geral: [
    { label: ['Morador', 'Moradora'], weight: 4, outfit: {
      clothes: [s(LONG, WARM), s(SHORT, WARM), s(BLOUSE, WARM)], vest: [s(VEST, RUSTIC, 0.25)], legs: [s(PANTS_PLAIN, DARK), s(SKIRT, DARK, 0.5)],
      shoes: [s(SHOES, DARK), s(BOOTS, ['brown'])], hair: 'rustic', beard: 0.3 } },
    { label: ['Viajante', 'Viajante'], weight: 3, outfit: {
      clothes: [s(LONG, RUSTIC)], cape: [s(CAPE, CLOAK, 0.6)], hat: [s(HOOD, CLOAK, 0.3)], legs: [s(PANTS_PLAIN, DARK)], shoes: [s(BOOTS, ['brown', 'espresso'])],
      backpack: [s(/backpack\/backpack$/, undefined, 0.5)], hair: 'rustic', beard: 0.4 } },
    { label: ['Comerciante', 'Comerciante'], weight: 2, outfit: {
      clothes: [s(LONG, RICH), s(BLOUSE, RICH)], vest: [s(VEST, ['black', 'maroon', 'forest', 'navy'], 0.5)], belt: [s(BELT, ['brown', 'leather'], 0.6)],
      legs: [s(PANTS, DARK)], shoes: [s(BOOTS, ['brown', 'espresso']), s(SHOES, DARK)], hat: [s(CAP, RICH, 0.3)], hair: 'neat', beard: 0.35 } },
    { label: ['Guarda', 'Guarda'], weight: 1, outfit: {
      armour: [s(LEATHER_ARMOUR, ['brown', 'leather'])], hat: [s(GUARD_HELM, STEEL, 0.7)], legs: [s(PANTS_PLAIN, ['charcoal', 'brown'])], shoes: [s(BOOTS, ['black', 'espresso'])],
      hair: 'short', beard: 0.35 } },
  ],
}

/** Rótulo bonito dos estilos de cabelo → regex do id, por corpo. */
export const HAIR_STYLES: Record<HairStyle, { male: RegExp; female: RegExp }> = {
  neat: {
    male: /hair_(parted|parted2|parted3|page|page2|swoop|swoop_side|curtains|plain|bangsshort|parted_side_bangs|parted_side_bangs2|relm_short)$/,
    female: /hair_(page|page2|bob|bob_side_part|lob|parted|parted2|parted3|bangs|bangslong|bangslong2|long_center_part|long_straight|half_up|bangs_bun|ponytail|ponytail2|high_ponytail|princess|shoulderl|shoulderr|topknot_long|topknot_short)$/,
  },
  rustic: {
    male: /hair_(messy1|messy2|messy3|mop|bedhead|halfmessy|cowlick|curly_short|curly_short2|vt_desgrenhado|unkempt|ponytail|single|long_messy|natural|afro|cornrows|dreadlocks_short|twists_fade|curly_long)$/,
    female: /hair_(long|long_messy|long_messy2|loose|curly_long|braid|braid2|shoulderl|shoulderr|messy2|curls_large|wavy|xlong_wavy|long_tied|pigtails|curtains_long|unkempt|natural|afro|cornrows|dreadlocks_long|twists_straight|vt_desgrenhado)$/,
  },
  short: {
    male: /hair_(buzzcut|high_and_tight|messy1|messy3|plain|parted|page|swoop|curtains|bedhead|cowlick|flat_top_straight|flat_top_fade|curly_short|natural)$/,
    female: /hair_(pixie|bob|lob|messy2|messy3|plain|page|bangsshort|parted|curtains|idol|relm_short|curly_short|natural|vt_desgrenhado)$/,
  },
  elder: {
    male: /hair_(balding|plain|parted|buzzcut|high_and_tight|page|messy3|curtains)$/,
    female: /hair_(bob|lob|bangs_bun|half_up|page|plain|long_straight|ponytail|topknot_short|bangs)$/,
  },
}
