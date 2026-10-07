# Vortable — Plano do Projeto

Jogo/mesa virtual 2D top-down em pixel art (estilo Stardew Valley) onde o **mestre cria zonas**
que formam um mundo, e **4–7 jogadores** exploram em tempo real, cada um com seu boneco personalizado.

## Decisões fechadas

| Tema | Decisão |
|---|---|
| Arte | **LPC** (Liberated Pixel Cup) — grátis, CC-BY-SA/GPL → tela de créditos obrigatória |
| Custo | **100% grátis** (nada de servidor pago) |
| Jogadores | 4 a 7 por sessão |
| Ritmo | **Tudo em tempo real** (exploração e combate) |
| Ficha de RPG | **Não** — o programa é o mundo; regras ficam fora |

## Stack

- **TypeScript** em tudo
- **Phaser 3** — motor 2D (tilemaps, animação, colisão, câmera)
- **Vite** — build/dev do cliente
- **Colyseus** (Node.js) — servidor multiplayer, uma *sala* por zona
- **Electron** — app de Windows que já embute o servidor (o mestre hospeda)
- Jogadores entram pelo **app ou pelo navegador**

### Hospedagem grátis
O app do mestre roda o servidor localmente. Para os jogadores de fora entrarem:
1. **Cloudflare Quick Tunnel** (`cloudflared`) — grátis, sem conta, gera um link `https://...` (padrão)
2. Alternativas: **Tailscale** (rede privada grátis) ou **playit.gg**

## Estrutura do repositório

```
packages/
  shared/   tipos, formato de zona/mundo, constantes, protocolo de rede
  client/   Phaser + Vite (jogo, editor, criador de personagem)
  server/   Colyseus (salas por zona, estado autoritativo)
  desktop/  Electron (empacota client + server)
assets/
  lpc/      sprites LPC + CREDITS
```

## Marcos

### M0 — Fundação
- Monorepo, Vite + Phaser rodando
- Importação do LPC (tiles + spritesheet de personagem)
- Um mapa de teste, boneco andando em 4 direções com animação
- Colisão, câmera seguindo, **y-sort** (passar atrás/na frente de árvores)
- ✅ *"Já parece um joguinho"*

### M1 — Editor de zonas
- Camadas: chão, decoração, objetos, acima-do-jogador (telhados, copas)
- **Autotile** de terrenos (grama, terra, água, areia...)
- Paleta de objetos com busca e categorias
- Pintura de colisão, borracha, conta-gotas, desfazer/refazer
- Salvar/carregar zona (JSON) + botão **Testar**
- ✅ *Mestre cria uma zona e anda nela*

### M2 — Mundo e zonas conectadas
- Saídas: bordas, portas, escadas → levam a outra zona
- Carrega apenas a zona atual; transição com fade
- Visão geral do mundo (grafo de zonas)
- Interiores (casa = outra zona)
- ✅ *Mundo explorável com várias áreas*

### M3 — Criador de personagem
- Camadas LPC: corpo, pele, olhos, cabelo, barba, cicatrizes/marcas, roupas, armadura, capa, sapatos, acessórios, armas
- Recoloração por paleta
- Prévia animada (andar, atacar, conjurar...), aleatorizar, salvar
- Personagem compilado em um spritesheet único (performance)
- ✅ *Cada jogador cria seu boneco único*

### M4 — Multiplayer
- Mestre cria sessão → código/link; jogadores entram
- Movimento em tempo real com interpolação; cada jogador pode estar numa zona diferente
- Chat com balão sobre a cabeça
- Papéis: mestre × jogador
- Túnel grátis integrado no app do mestre
- ✅ *Sessão real com amigos*

### M5 — Interações
- Portas, baús, placas, alavancas, itens no chão
- NPCs com diálogo (criados pelo mestre)
- Inventário simples
- Gatilhos: "ao pisar/interagir aqui → acontece X"
- ✅ *O mundo reage aos jogadores*

### M6 — Ação em tempo real + poderes do mestre
- Animações de ação LPC: golpe, estocada, arco, magia, dano, morte
- Vida (barra) controlada de forma simples — sem ficha
- Inimigos/NPCs controlados pelo mestre ou com IA básica (patrulhar, perseguir)
- Mestre: teleportar, congelar, possuir NPC, spawnar, rolar dados na tela
- Dia/noite e iluminação (tochas, cavernas)

### M7 — App e polimento
- Instalador Windows (Electron)
- Sons e música, menus, configurações
- Otimizações, tela de créditos LPC

## Riscos conhecidos
- **Estilo LPC** é um pouco diferente do Stardew (perspectiva levemente mais "de frente"). Aceito.
- **Licença CC-BY-SA/GPL** do LPC: precisa creditar autores; arte derivada herda a licença.
- **Rede doméstica**: túnel resolve a maioria dos casos; latência depende da internet do mestre.
