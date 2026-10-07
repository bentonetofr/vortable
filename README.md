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

No jogo: `WASD`/setas andam, `Shift` corre, `C` mostra colisões, `R` sorteia a aparência.

## Estrutura

- `src/engine/` — o motor (Phaser). Não depende de React, Supabase nem do Vorterium.
  Entrada: `mountVortable(div, opções)`.
- `src/dev/` — harness para rodar o motor sozinho.
- `public/assets/lpc/` — arte LPC usada direto (personagem em camadas + paletas, terrenos).
- `public/assets/catalog/` — objetos recortados pelo script de catálogo (não editar à mão).
- `assets-src/` — arte original. `node scripts/build-catalog.mjs` recorta os objetos, calcula a
  colisão de cada um e gera `public/assets/catalog/objects.json`.

## Licença da arte

A arte é do projeto Liberated Pixel Cup (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY). Créditos em
`assets-src/credits/` — precisam aparecer numa tela de créditos do jogo.
