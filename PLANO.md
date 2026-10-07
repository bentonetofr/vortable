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
| Temas da arte | **Tudo que for LPC e coeso entra**, temas diferentes (castelo/gótico, oriental, urbano) em **categorias separadas** — quanto mais customização, melhor |
| Hora do dia | **As duas**: ciclo dia/noite que corre sozinho **e** hora fixa por zona |
| Nomes das peças | Nomeadas à mão as mais usadas; o resto com nome automático, melhorado aos poucos |

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

### M3.1 — Objetos 2.0 ✅ (concluído)
- **Tipos de objeto**: *em pé* (y-sort pela linha do pé, colide), *no chão* (sempre por baixo:
  tapetes), *na parede* (placas, tochas), *por cima* (copas e telhados: transparentes com o
  boneco embaixo). Árvores e móveis altos ficam semitransparentes quando escondem o boneco
- **Colisão por retângulos** (vários por peça) + **linha do pé** editável; automática pelo pé
  (árvores, postes) ou pela base (móveis, barris, pedras)
- **Animação** (folhas em tira; cada cópia começa num quadro diferente), **espelhar** (`F`)
- **Variantes**: cores (as 5 versões de cada árvore viram 1 peça) e estados (baú
  fechado/entreaberto/aberto); troca no painel, até em objeto já colocado
- **Pacotes com manifesto** (`assets-src/packs/<pacote>/pack.json`): fonte, licença, folhas,
  modo de recorte (automático, tira animada, retângulos à mão) e a curadoria de cada peça;
  créditos por pacote na tela de créditos
- **Curadoria no editor** (só no `npm run dev`): nome, categoria, tags, tipo, colisão
  desenhada sobre a arte, linha do pé e luz → grava no `pack.json` e recarrega na hora
- Paleta com **busca por tag/tipo**, **favoritos** e **recentes**; painel da peça escolhida
- Pacotes de amostra: árvores (67 modelos nomeados, 247 peças com variantes), LPC Base
  (estantes, armários, cristaleiras, mesas, cadeiras, cama, fogões, baús, barris, placas,
  pedras, copas e troncos montáveis, luzes) e a tocha animada — 126 peças na paleta
- Luz por peça já fica gravada (tochas, fogões, postes) e passa a brilhar no M3.5
- ✅ *Qualquer peça LPC pode entrar no editor com comportamento certo*

### M3.2 — Grande leva de arte ✅ (concluído)
Regra de coesão: **só LPC** (perspectiva ¾, grade de 32px, mesma família de cores), nada
redimensionado; temas diferentes em categorias próprias; nada moderno.

**Objetos — 2.456 peças em 13 pacotes** (nomeadas à mão as mais usadas):
| Pacote | O que tem |
|---|---|
| Vila medieval | cemitério, poço, carroças, feno, ferramentas, forca/pelourinho, alvos, tendas, barracas de feira, toldos, estandartes, placas penduradas, lampiões e tochas animados, chafarizes animados, fogueira animada |
| Pedras | 74 modelos × 8 variantes (cinza, escura, carvão, arenito, com e sem neve): rochedos, menires, dólmen, estalagmites, seixos |
| Plantas | 272: flores, ervas, cogumelos, arbustos, tocos, troncos caídos, plantas aquáticas |
| Fazenda | 7 plantações × 5 estágios (variantes), comida (82), sacos, caixotes, barcos |
| Interior | cozinha (balcões, fogões, forno animado), estantes, armários, lareira, relógio animado, armas na parede |
| Móveis de madeira | 83 modelos × 4 madeiras (escura, clara, branca, verde): camas, mesas, armários, pianos, órgão, biombos, relógios |
| Estofados | 53 modelos × 4 cores: sofás, poltronas, cortinas, abajures |
| Masmorra | catres, celas, correntes, ossos, teias, fogo e caldeirão animados |
| Portas e janelas | 20 portas com estados (fechada/aberta) + ~110 janelas, arcos, batentes |
| Atlas | cerejeiras (oriental), frutas e legumes |

**Terrenos novos — 433**:
- **Paredes em perspectiva**: 252 estilos em 16 famílias (pedra, tijolo, papéis de parede,
  reboco, enxaimel, madeiras); pinta-se uma faixa de 3 tiles e sai moldura + face + rodapé
- **Camada de cima** (nova): 32 **molduras de teto** (a borda escura dos cômodos) e 40
  **tapetes** — pintados por cima do piso, com borracha/balde próprios
- **96 pisos** (madeira, ladrilho, pedra), escolhidos por emendarem sem costura
- **Cercas** (camada de tiles nova): 9 tipos que se ligam sozinhos, com y-sort e colisão
- Fazenda: trigo verde, trigo maduro, capim alto, terra arada (sobre grama)

**Recursos que vieram junto**: altura de objeto (comida/velas em cima da mesa), busca de
terrenos, variantes de estado (portas, baús, plantações), animações dentro das folhas.

- ⏳ Ficou pra depois: **telhados e paredes externas modulares** ([LPC] Roofs, Thatched-roof
  Cottage) — precisam de uma ferramenta de "telhado" própria; peças de castelo/gótico dos
  atlas (são tilesets de construção, não objetos); terra arada que funcione fora da grama
- ✅ *Dá pra montar uma vila, uma taverna mobiliada e uma masmorra*

### M3.3 — Controles e conforto do editor ✅ (concluído)
Editar tem que ser gostoso: câmera que responde na hora e atalhos de quem usa Inkarnate,
Photoshop e Figma.
- **Zoom contínuo e suave**: a roda (e o "pinça" do trackpad, e Ctrl+roda) dá zoom em passos
  pequenos, animado, sempre em direção ao cursor; de 10% a 800%. `Ctrl +`/`Ctrl −`,
  `Ctrl 0` enquadra a zona, `Ctrl 1` = 100%, `Ctrl 2` = 200%. Controle de zoom no canto da tela
- **Mover a tela**: Espaço + arrastar (cursor de mão), botão do meio ou direito, setas/WASD
  (Shift = rápido)
- **Pincel**: `Shift + clique` pinta em linha reta desde o último ponto (paredes, cercas,
  caminhos); `Alt + roda` muda o tamanho do pincel
- **Objetos**: seleção múltipla (Shift/Ctrl + clique, ou arrastar um retângulo no vazio),
  mover em grupo, `Ctrl A`, `Ctrl C / X / V`, `Ctrl D` duplica, setas empurram 1px
  (Shift = 8px), `Del` apaga todos, `F` espelha todos, `,` e `.` trocam a variante
- **Carimbo esperto**: arrastar com a ferramenta de objeto vai "pintando" objetos
  espaçados; com Shift, cada um sai com variante e espelho sorteados (florestas em segundos)
- **`?` mostra todos os atalhos** numa janela
- ✅ *Editar uma zona grande é rápido e não cansa*

### M3.4 — Estruturas (cômodos estilo Stardew) e painel novo ✅ (concluído)
**Cômodos como no Stardew Valley**: hoje dá pra chegar no visual (parede de 3 tiles em cima,
borda escura com moldura em volta, piso dentro), mas pintando 3 camadas à mão. A ferramenta
nova faz isso numa ação só, em qualquer forma:
- **Ferramenta Cômodo**: arrastar um retângulo (ou pintar a forma com o pincel — salas em L,
  corredores, a entradinha da porta embaixo) e sai pronto: piso dentro, **parede com face**
  em cima de cada trecho que tem a borda ao norte, **moldura escura** em toda a volta
  (esquerda, direita, embaixo) e vazio por fora
- Cômodos vizinhos viram uma casa com **paredes internas**; borracha de cômodo encolhe/abre
  vãos e a parede se refaz sozinha (porta entre cômodos = um corredor de 1 tile)
- **Estilo do cômodo** = piso + parede (252) + moldura (32) + altura da parede (0 a 4;
  0 = só a borda, pra corredores de castelo/masmorra vistos de cima) e **estilos prontos**
  (casa de fazenda, taverna, castelo, masmorra, caverna)
- Trocar o estilo de um cômodo já feito (clique no cômodo com o estilo novo)
- Colisão e profundidade certas (a face da parede bloqueia; quem anda atrás de móveis altos
  some atrás deles, como já acontece)
- Portas e janelas do M3.2 encaixam na face da parede

**Painel de peças mais limpo** (o monte de abas some):
- Em cima: busca + **6 grupos com ícone** (Favoritos, Recentes, Natureza, Casa, Vila,
  Masmorra) no lugar de 25 categorias soltas
- Embaixo do grupo: só as **subcategorias dele**, numa linha que rola
- A grade mostra as peças **divididas por subcategoria** com o nome e a contagem
- Categorias repetidas/confusas são unidas ("Tocos e galhos" + "Troncos e galhos"; "Interior")
- Mesmo esquema na aba de terrenos (Natureza, Interior, Paredes, Cercas) e a aba nova de
  **cômodos**
- Feito: modos Cômodo / Parede / Porta; paredes finas automáticas entre cômodos de estilos
  diferentes; 6 estilos prontos; o vazio na borda de um cômodo colide (paredes finas fecham)
- Colisão vem da estrutura: todo tile que toca a parede é sólido (a parede inteira, até o
  rodapé) e a borda em volta do cômodo também, em qualquer fundo (vale em zona de exterior)
- ✅ *Montar o interior de uma casa como no Stardew leva um minuto*

### M3.5 — Iluminação e atmosfera ✅ (concluído)
- **Luz ambiente por zona**: cor + intensidade, com presets (Dia, Entardecer, Noite,
  Interior, Caverna, Masmorra)
- **Fontes de luz**: objetos com luz própria (tocha, lampião, vela, lareira, janela acesa) e
  uma ferramenta **Luz** pra pôr luz solta no mapa; raio, cor, intensidade e **tremulação**
- **Como desenha**: uma camada de escuridão por cima do mapa, com as luzes "abrindo" buracos
  em gradiente e somando cor (estilo Stardew à noite); orçamento de ~64 luzes por zona
- **Hora do dia, dos dois jeitos**: **ciclo dia/noite** que corre sozinho (velocidade
  ajustável) **ou hora fixa** por zona (a taverna é sempre noite, a masmorra sempre escura);
  no M4 o mestre pode pausar, adiantar e mudar a hora pra todos
- **Janelas que acendem** à noite; brilho da lava e da água venenosa
- **Partículas leves**: fumaça de chaminé, faíscas de fogueira, vaga-lumes, poeira de masmorra
- Editor: alternar "ver iluminação" e um controle de hora pra pré-visualizar
- Feito, além do previsto:
  - **Sombras do sol**: árvores, objetos altos e os bonecos deitam a silhueta no chão, longa de
    manhã e à tarde, curta ao meio-dia, girando com o sol; somem à noite
  - **A luz respeita as paredes** dos cômodos (polígono de visibilidade com penumbra suave)
  - **Facho de sol pelas janelas** nos interiores de dia; sombra macia sob os pés do boneco
  - Halo quente em volta do fogo quando escurece; o relógio aparece no teste
- ⏳ Ficou pra depois: objetos barrando luz (na perspectiva ¾ o pé faria sombra no próprio
  desenho); fumaça de chaminé (falta casa por fora); controle da hora pelo mestre (M4)
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
