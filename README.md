# Vortable

Mundo 2D em pixel art (estilo Stardew Valley) para RPG de mesa: o mestre cria zonas,
os jogadores exploram em tempo real com bonecos personalizados. Integra com o Vorterium.

Plano completo: [PLANO.md](PLANO.md)

## Rodar

```bash
npm install
npm run dev
```

Abre em http://localhost:5180 — `WASD`/setas andam, `Shift` corre, `R` sorteia a aparência,
`C` mostra as caixas de colisão.

## Estrutura

- `src/engine/` — o motor (Phaser). Não depende de React, Supabase nem do Vorterium.
  Entrada: `mountVortable(div, opções)`.
- `src/dev/` — harness para rodar o motor sozinho.
- `public/assets/lpc/` — arte LPC (personagem em camadas + paletas, terrenos, árvores).
- `scripts/extract-sprites.mjs` — detecta objetos soltos numa folha e gera o JSON de retângulos.

## Licença da arte

A arte é do projeto Liberated Pixel Cup (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY). Créditos em
`assets-src/credits/` — precisam aparecer numa tela de créditos do jogo.
