# Vortable — Plano do Projeto

Jogo/mesa virtual 2D top-down em pixel art (estilo Stardew Valley) onde o **mestre cria zonas**
que formam um mundo, e **4–7 jogadores** exploram em tempo real, cada um com seu boneco personalizado.

## Decisões fechadas

| Tema | Decisão |
|---|---|
| Arte | **LPC** (Liberated Pixel Cup) — grátis, CC-BY-SA/GPL → tela de créditos obrigatória |
| Custo | **100% grátis** (nada de servidor pago) |
| Integração | **Vorterium** (login, campanhas, fichas) |
| Jogadores | 4 a 7 por sessão |
| Ritmo | **Tudo em tempo real** (exploração e combate) |
| Ficha de RPG | **Não** — o programa é o mundo; regras ficam fora |

## Stack

- **TypeScript** em tudo
- **Phaser 3** — motor 2D (tilemaps, animação, colisão, câmera)
- **Vite** — build/dev
- **Vorterium** (React + Supabase, Vercel) — login, campanhas, papéis, fichas, persistência
- **WebRTC data channels** — multiplayer em tempo real, o **navegador do mestre é o host**
- App desktop (Electron) só no fim, se ainda fizer sentido

### Integração com o Vorterium
```
Vortable (este repo)   motor Phaser, sem React/Supabase → mountVortable(div, opções)
        ▲  contratos: Storage · Signal · Sheets · Events
Ponte no Vorterium     src/features/vortable/ (aba da campanha), implementa os contratos
        ▲
Supabase               auth · campaign_members · fichas · tabelas vortable_*
```
- Tabelas novas: `vortable_worlds`, `vortable_zones`, `vortable_zone_exits`,
  `vortable_appearances`, `vortable_world_state` (migrations + RLS no padrão do Vorterium)
- Ficha ↔ boneco por **adaptador por sistema** (Altherium, D&D, Vampiro, Terra Devastada...):
  nome, vida, retrato; vida sincroniza nos dois sentidos
- Deploy: Vortable vira repo no GitHub, instalado no Vorterium como dependência com tag

### Rede (100% grátis)
- Supabase Realtime só para a **sinalização** (aperto de mão) — poucas mensagens
- Posições/ações vão P2P jogador ↔ mestre (o Supabase grátis não aguenta 7 jogadores a ~10 msg/s)
- STUN do Google; TURN opcional via `.env` (mesmo esquema do `mesaRtc.ts` do Vorterium)

## Estrutura do repositório

```
src/engine/   motor (Phaser) — mundo, editor, personagem, rede
src/dev/      harness para rodar sozinho
public/assets/lpc/   arte LPC
assets-src/credits/  créditos obrigatórios
scripts/      ferramentas de assets
```

## Marcos

### M0 — Fundação ✅ (concluído)
- Monorepo, Vite + Phaser rodando
- Importação do LPC (tiles + spritesheet de personagem)
- Um mapa de teste, boneco andando em 4 direções com animação
- Colisão, câmera seguindo, **y-sort** (passar atrás/na frente de árvores)
- ✅ *"Já parece um joguinho"*

### M1 — Editor de zonas ✅ (concluído)
- Chão com **autotile** de 30 terrenos (grama, terra, areia, neve, pedra, água, lava, buracos)
- Objetos com y-sort pelo pé; paleta com busca e categorias (247 árvores por enquanto)
- Pincel, balde, borracha, conta-gotas (Alt+clique), selecionar/mover/apagar, ponto de início
- Desfazer/refazer, grade, ver colisões, encaixe, zoom e arrastar a tela
- Salvar/abrir (contrato `ZoneStorage`), exportar/importar JSON + botão **Testar**
- ⏳ Pendente (vai junto da leva de arte): camada "acima do jogador" (telhados), áreas de
  colisão pintadas à mão, ajuste fino do pé de cada objeto
- ✅ *Mestre cria uma zona e anda nela*

### M2 — Mundo e zonas conectadas ✅ (concluído)
- Saídas (portas, bordas, escadas) desenhadas no editor, com destino escolhido no painel
  e "ligar ida e volta" (cria a saída de volta na outra zona)
- Carrega apenas a zona atual; transição com fade; chega na saída de destino
- Mapa do mundo: cartões arrastáveis, setas das ligações, zona inicial (★)
- Interiores básicos: fundo vazio, pisos (madeira, pedra, 3 tapetes), paredes (tijolo, pedra)
- Contrato `WorldStorage` (mundo + zonas) — é o que o Vorterium vai implementar no M4
- ⏳ Pendente (leva de arte): casas por fora com porta, móveis, paredes com perspectiva
- ✅ *Mundo explorável com várias áreas*

### M3 — Criador de personagem ✅ (concluído)
- Catálogo gerado do Universal LPC (commit fixo): 388 itens, 46 espaços em 5 abas
  (Corpo, Cabelo, Roupa, Acessórios, Marcas — inclui cicatrizes, ferimentos, prótese)
- Corpo masculino/feminino, pele (22 tons), até 3 cores por item, variantes,
  camadas na frente/atrás do corpo (capas, asas), cabeças humanas e fantásticas
- Prévia animada (parado/andando/correndo, 4 direções), miniaturas, aleatório
- Personagens salvos (contrato `CharacterStorage`); o "em uso" vai pro Testar e pro jogo
- Folhas (~13 MB) no projeto, sem depender de CDN; créditos gerados automaticamente
- ⏳ Pendente: tipos de corpo extras do LPC (musculoso, adolescente, criança), expressões
- ✅ *Cada jogador cria seu boneco único*

### M4 — Integração Vorterium + multiplayer
- Aba **Vortable** na campanha do Vorterium; login e papéis vindos de `campaign_members`
- Migrations `vortable_*`; zonas e aparências salvas no Supabase
- Mestre inicia sessão ao vivo → jogadores avisados pelas notificações do site
- Host WebRTC no navegador do mestre; movimento com interpolação; zonas diferentes por jogador
- Boneco ligado à ficha (nome, vida, retrato); chat com balão sobre a cabeça; dados no histórico
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
- **Rede**: algumas redes (4G/CGNAT) exigem TURN; latência depende da internet do mestre; se o mestre fechar a aba a sessão pausa.
