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
- http://localhost:5180/?jogar — só o jogo, na zona de demonstração

### Atalhos do editor

| Tecla | Ação |
|---|---|
| `B` / `G` / `E` | pincel / balde / borracha |
| `O` / `V` / `P` | colocar objeto / selecionar e mover / ponto de início |
| `[` `]` | tamanho do pincel |
| `H` / `K` / `N` | grade / colisões / encaixar na grade |
| `Ctrl+Z` / `Ctrl+Y` | desfazer / refazer |
| `Ctrl+S` | salvar |
| `Del` | apagar objeto selecionado |
| botão direito ou do meio, `Espaço`+arrastar | mover a tela |
| roda do mouse | zoom |
| `Esc` | sair do teste / soltar ferramenta |

No jogo: `WASD`/setas andam, `Shift` corre, `C` mostra colisões, `R` sorteia a aparência.

## Estrutura

- `src/engine/` — o motor (Phaser). Não depende de React, Supabase nem do Vorterium.
  Entrada: `mountVortable(div, opções)`.
- `src/dev/` — harness para rodar o motor sozinho.
- `public/assets/lpc/` — arte LPC (personagem em camadas + paletas, terrenos, árvores).
- `assets-src/` — arte original. `node scripts/build-catalog.mjs` recorta os objetos, calcula a
  colisão de cada um e gera `public/assets/catalog/objects.json`.

## Licença da arte

A arte é do projeto Liberated Pixel Cup (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY). Créditos em
`assets-src/credits/` — precisam aparecer numa tela de créditos do jogo.
