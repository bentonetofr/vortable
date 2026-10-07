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

### M3.1 — Objetos 2.0 (fundação técnica pra arte nova)
A arte que vem a seguir (casas inteiras, paredes, móveis, tochas) precisa de recursos que o
sistema de objetos ainda não tem. Sem isso, os objetos novos ficariam "colados" no chão.
- **Tipos de objeto**: *em pé* (y-sort, colide: árvore, armário), *no chão* (sempre por baixo
  do boneco: tapete, mancha, folhas), *na parede* (sem colisão, preso à parede: quadro, tocha,
  janela), *por cima* (telhado/copa: fica translúcido quando o boneco passa atrás)
- **Colisão editável**: um ou mais retângulos por objeto, ajustados num editor de colisão
  (corrige as árvores tortas de hoje e permite casas com porta vazada)
- **Objetos animados**: sequência de quadros (tocha, fogueira, moinho, água)
- **Espelhar** objeto (esquerda/direita) e **variantes** (mesma peça em cores/estados)
- **Pacotes de arte com manifesto**: cada pacote tem `pack.json` (fonte, autores, licença,
  nomes em português, categoria, tags, colisão, luz, animação). O script gera catálogo e
  créditos a partir dos manifestos
- **Curadoria no próprio editor** (só em desenvolvimento): clicar num objeto do catálogo e
  editar nome, categoria, tags, colisão e luz, salvando no manifesto — é o que torna viável
  curar centenas de peças
- Paleta de objetos com **tags** e **favoritos/recentes**
- ✅ *Qualquer peça LPC pode entrar no editor com comportamento certo*

### M3.2 — Grande leva de arte (exteriores, interiores, pedra, natureza)
Regra de coesão: **só LPC** (mesma perspectiva ¾, grade de 32px, mesma família de cores),
**tema medieval/fantasia rural**. Nada é redimensionado. Fica de fora o que quebra o tema
(máquinas de venda, privadas modernas, pichação, portais japoneses, fachadas parisienses).

| Grupo | O que entra | Pacotes (OpenGameArt) |
|---|---|---|
| Vila | casas prontas de enxaimel e palha, poço, carroças, barracas de feira, toldos, barris, caixotes, lenha, varal, espantalho, placas, estábulo | [LPC] Medieval Village Decorations · Thatched-roof Cottage · Signposts, graves, line cloths and scare crow |
| Construções modulares | paredes externas, telhados, portas e janelas pra montar casas sob medida | [LPC] Roofs · [LPC] Windows & Doors · LPC Tile Atlas |
| Cercas e muros | cerca de madeira, muro de pedra, grade de ferro, portões | LPC Tile Atlas · Medieval Village Decorations |
| Pedra e relevo | rochas, pedregulhos, dólmen, pedras de neve, cristais | [LPC] Rocks · LPC Tile Atlas |
| Natureza | flores, plantas, fungos, folhas, troncos, cerejeiras, arbustos | [LPC] Flowers/Plants/Fungi/Wood · LPC Tile Atlas |
| Fazenda | terra arada (volta!), plantações com estágios, feno, sacos, ferramentas | [LPC] Farming tilesets · LPC Tile Atlas |
| Interiores — estrutura | **paredes com perspectiva** (topo + face, como no Stardew), dezenas de pisos, rodapés, escadas | [LPC] Walls · [LPC] Floors |
| Interiores — móveis | camas, mesas, cadeiras, bancos, estantes, armários, baús, lareira, fogão, cortinas, quadros, vasos, velas, livros | [LPC] Wooden Furniture · [LPC] Upholstery · [LPC] House interior and decorations · LPC Tile Atlas |
| Comida e utensílios | frutas, legumes, pães, carnes, peixes, garrafas, panelas | LPC Tile Atlas · House interior |
| Masmorra | correntes, grades, ossos, alavancas, pedras soltas, portas de ferro | [LPC] Dungeon Elements |
| Luzes | tochas (animadas), lampiões, braseiros, velas, lareira | [LPC] Animated Torch · Medieval Village · House interior |

- **Paredes de interior** viram um terreno especial com perspectiva: pintar a parede gera o
  topo e a face automaticamente (no formato do [LPC] Walls)
- Estimativa: **800 a 1.500 peças** depois da curadoria; +20 a 40 MB de arte
- Licenças: CC-BY-SA 3.0/4.0, GPL, OGA-BY, CC-BY — todas permitem uso com crédito
  (a tela de créditos já existe e passa a listar cada pacote)
- ✅ *Dá pra montar uma vila com casas, uma taverna mobiliada e uma masmorra*

### M3.3 — Iluminação e atmosfera
- **Luz ambiente por zona**: cor + intensidade, com presets (Dia, Entardecer, Noite,
  Interior, Caverna, Masmorra)
- **Fontes de luz**: objetos com luz própria (tocha, lampião, vela, lareira, janela acesa) e
  uma ferramenta **Luz** pra pôr luz solta no mapa; raio, cor, intensidade e **tremulação**
- **Como desenha**: uma camada de escuridão por cima do mapa, com as luzes "abrindo" buracos
  em gradiente e somando cor (estilo Stardew à noite); orçamento de ~64 luzes por zona
- **Ciclo dia/noite** opcional por zona (exteriores); quem controla a hora é o mestre (M4)
- **Janelas que acendem** à noite; brilho da lava e da água venenosa
- **Partículas leves**: fumaça de chaminé, faíscas de fogueira, vaga-lumes, poeira de masmorra
- Editor: alternar "ver iluminação" e um controle de hora pra pré-visualizar
- ✅ *Uma taverna à noite, com lareira e velas, parece aconchegante; uma masmorra, ameaçadora*

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
- **Curadoria da arte** (M3.2) é o trabalho mais demorado: nomear e ajustar centenas de
  peças. A curadoria dentro do editor (M3.1) existe pra reduzir isso.
- **Paredes com perspectiva**: o formato do [LPC] Walls ainda precisa ser estudado (uma
  investigação curta no começo do M3.2).
- **Desempenho** com muitas luzes e objetos: zonas grandes podem precisar dividir o chão
  em pedaços e limitar luzes.
