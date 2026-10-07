# Vortable

Mundo 2D em pixel art (estilo Stardew Valley) para RPG de mesa: o mestre cria zonas,
os jogadores exploram em tempo real com bonecos personalizados. Integra com o Vorterium.

Plano completo: [PLANO.md](PLANO.md)

## Rodar

Dois cliques em **Testar.bat**, ou:

```bash
npm install
npm run dev
```

- http://localhost:5180 — **editor de zonas**
- http://localhost:5180/?personagem — **criador de personagem** (ou o botão *Personagem* no editor)
- http://localhost:5180/?jogar — só o jogo, começando na zona inicial do mundo (★ no mapa do mundo)

### Atalhos do editor

| Tecla | Ação |
|---|---|
| `B` / `G` / `E` | pincel / balde / borracha |
| `O` / `V` / `P` | colocar objeto / selecionar e mover / ponto de início |
| `X` | saída: arraste pra desenhar a área que leva a outra zona; o destino se escolhe no painel |
| `[` `]` | tamanho do pincel |
| `H` / `K` / `N` | grade / colisões / encaixar na grade |
| `Ctrl+Z` / `Ctrl+Y` | desfazer / refazer |
| `Ctrl+S` | salvar |
| `Del` | apagar objeto selecionado |
| botão direito ou do meio, `Espaço`+arrastar | mover a tela |
| roda do mouse | zoom |
| `Alt`+clique | conta-gotas: copia o terreno ou o objeto sob o mouse |
| `Esc` | sair do teste / soltar ferramenta |

### Mundo e zonas

- Cada zona é um pedaço do mundo; só a zona atual fica carregada.
- **Saídas** (ferramenta `X`) levam a outra zona. No painel, escolha *Leva para* e *Chega em*;
  **Ligar ida e volta** faz a saída de lá trazer de volta (e cria uma, se não existir).
- **Mundo** (barra de cima) mostra o mapa do mundo: zonas como cartões, setas pras saídas,
  ★ = onde os jogadores começam. Arraste os cartões pra organizar.
- **Nova → Interior** cria uma zona pequena com fundo escuro; use os terrenos de *Interior*
  (pisos, tapetes, paredes).

### Objetos

- Quatro tipos: **em pé** (árvore, armário: o boneco passa na frente ou atrás), **no chão**
  (tapete: sempre por baixo), **na parede** (placa, tocha) e **por cima** (copa, telhado: fica
  transparente quando o boneco passa embaixo). Árvores e móveis altos também ficam
  transparentes quando escondem o boneco.
- Peças com **variantes** (cores da árvore, baú fechado/aberto) aparecem uma vez na paleta;
  troque a variante no painel da peça, inclusive de um objeto já colocado.
- `F` espelha. ★ marca favoritos; *Recentes* lembra o que você usou. A busca acha por nome,
  tag e tipo (sem precisar de acento).
- **Curar** (só com `npm run dev`): ajusta nome, categoria, tags, tipo, colisão (desenhe
  retângulos por cima da arte), linha do pé e luz da peça, e grava no `pack.json` do pacote.

### Personagem

- 388 itens LPC em 46 espaços (corpo, cabeça, cabelo, barba, roupa, chapéu, capa, cicatrizes...),
  corpo masculino ou feminino, 22 tons de pele e cores por peça.
- **Salvar** guarda o personagem e o deixa *em uso*: é ele que aparece no Testar e no jogo.
- As folhas ficam em `public/assets/character/sheets/` (baixadas por
  `node scripts/build-character-catalog.mjs`, que também gera o catálogo e os créditos).

No jogo: `WASD`/setas andam, `Shift` corre, `C` mostra colisões, `R` sorteia a aparência.

## Estrutura

- `src/engine/` — o motor (Phaser). Não depende de React, Supabase nem do Vorterium.
  Entrada: `mountVortable(div, opções)`.
- `src/dev/` — harness para rodar o motor sozinho.
- `public/assets/lpc/` — arte LPC usada direto (personagem em camadas + paletas, terrenos).
- `public/assets/catalog/` — objetos recortados pelo script de catálogo (não editar à mão).
- `public/assets/character/` — catálogo, paletas e folhas do personagem (gerados por script).
- `assets-src/packs/<pacote>/` — arte de objetos em **pacotes**: as folhas, `CREDITS.txt` e o
  manifesto `pack.json` (fonte, licença, folhas, como recortar, e a curadoria de cada peça).
  `npm run catalog` recorta tudo, calcula colisões e gera `public/assets/catalog/objects.json`
  (`npm run catalog -- --pack nome` refaz só um pacote).
- `assets-src/lpc/` — terrenos e texturas de interior.

## Licença da arte

A arte é do projeto Liberated Pixel Cup (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY). Créditos em
`assets-src/credits/` e no `CREDITS.txt` de cada pacote — aparecem na tela de créditos
(link no rodapé do editor e no criador de personagem).
