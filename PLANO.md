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

#### Hora dourada (amanhecer e entardecer) ✅
**Semi noite** (novo clima, e no ciclo entre 18h40 e 20h30): o mapa vira um gradiente — lado
do sol ainda rosado e claro, lado oposto já azul-noite. Noite começa às 19h e fecha às 20h; no ciclo, o crepúsculo (5h12–7h e 18h24–20h12) corre a 1/3 da
velocidade no relógio real, então a luz muda devagar (com dia de 24 min, 19h→20h leva ~2 min).
Paleta do céu em 22 pontos (índigo → magenta → salmão → ouro no amanhecer; creme → âmbar →
laranja → rosa → roxo no entardecer) e, nessas horas:
- banho de luz quente por cima do mapa, clarão grande vindo do lado do sol e **raios de luz**
  atravessando o mapa na direção das sombras, **fixos no cenário** (a câmera passa por eles; só a luz cintila devagar)
- sombras mais longas, fortes e **arroxeadas** (luz quente, sombra fria); cantos do mapa
  arroxeados; sombra de nuvens mais leve
- **grãos de luz dourados** flutuando, **bandos de pássaros** cruzando o céu, água cintilando em
  dourado; no amanhecer, **névoa baixa rosada** e **orvalho** brilhando na grama

#### Noite e dia aberto ✅
- **Noite de luar**: fio de azul na escuridão (não é preto), clarão frio do lado da lua, raios de
  luar sutis no cenário, **sombras da lua** longas e azuis (a lua cruza o céu das 18h às 6h),
  névoa baixa azulada
- **Manhã, meio-dia e tarde**: manchas de sol entre as folhas andando devagar, raios leves de sol
  fixos no cenário e um clarão suave do lado do sol

### M3.6 — Vento e vida (animações do mundo) ✅ (concluído)
O mundo parado parece foto: tudo que é leve mexe com o vento, e o fogo vive.
- **Vento por zona** (Parado / Brisa / Ventania) com **rajadas** que atravessam o mapa como
  ondas — o mesmo campo move árvores, grama e folhas, então tudo mexe junto
- **Plantas balançando**: árvores, arbustos, flores, plantações (cisalhamento feito na hora de
  desenhar, sem custo extra); **pendurados** (placas, lamparinas, sachês) balançam presos no
  topo; as sombras do sol acompanham o balanço
- **Tufos de grama balançando**: os tufinhos desenhados nos tiles de grama viram peças soltas
  (o que difere do miolo liso) que balançam com as rajadas e chacoalham quando alguém passa
  (as faixas claras de "onda" na grama foram testadas e tiradas)
- **Folhas**: caem das copas ziguezagueando (cor tirada da própria árvore: cerejeira solta
  pétala rosa), pousam e rolam pelo chão nas rajadas; na ventania entram folhas de fora
- **Fogo vivo**: línguas de chama subindo de toda tocha, lareira e fogueira (amarelo → laranja →
  vermelho, inclinando com o vento); fornos fechados não soltam chama
- **Água**: reflexos piscando (prateados à noite); **sombra de nuvens** passando de dia
- ✅ *Uma clareira com vento parece viva; uma fogueira à noite crepita*

### M3.7 — Tempo ✅ (concluído)
O mestre escolhe o tempo de cada zona (aba **Clima**):
- **Limpo, Nublado, Neblina, Garoa, Chuva, Tempestade, Neve leve, Neve, Nevasca**
- **Nuvens no céu**: no encoberto passam translúcidas por cima do mapa, e a sombra de cada uma
  corre pelo chão deslocada pelo sol (o mesmo desenho)
- A luz do dia fica mais cinza/escura conforme o tempo; sombra do sol some no encoberto; neve
  puxa pro azulado; vaga-lume não sai na chuva
- **Chuva**: gotas inclinadas pelo vento, respingos no chão; **tempestade**: vento forte e
  relâmpagos (dois clarões) que clareiam tudo — dentro de casa, piscam nas janelas
- **Neve**: flocos que flutuam, balançam e pousam; **nevasca**: horizontal, com névoa branca;
  **neblina**: névoa arrastando devagar (debaixo da escuridão: à noite só aparece perto da luz)
- ⏳ Depois: neve acumulando no chão, poças, som da chuva/trovão (M7), o mestre mudar o tempo
  ao vivo pra todos (M4)
- ✅ *Uma tempestade à noite na vila assusta; uma nevasca esconde o caminho*

### M3.8 — Sons ✅ (concluído)
Primeiro sintetizado (rejeitado: "não gostei muito"), depois **gravações livres**:
- Ambientes: *Nature Ambient Pack Vol 1* (JC Sounds, CC BY 4.0) — 15 laços em MP3 112 kb/s com
  emenda cruzada (16 MB, baixados só quando a camada toca)
- Passos: *Impact Sounds* (Kenney, CC0) + *Footsteps on different surfaces* (congusbongus, CC BY
  3.0); trovão: Jerimee (CC BY 3.0). Créditos em `credits/CREDITS-audio.txt`
- **Painel Sons** em cartões com ícone: 15 camadas, automático, volume, mudo, passos por chão
- **Passos sincronizados com a animação**: um som a cada quadro em que o pé toca o chão (andando:
  quadros 2 e 6; correndo: 0 e 4), com a gravação do chão sob os pés
- Automático segue tempo, hora, árvores; trovão a cada relâmpago; fogo/lago/pântano pela
  distância e lado; abafado dentro de casa; eco de sala/caverna
- ⏳ Depois: música (M7), sons de interação (M5)

### M4 — Integração Vorterium + multiplayer
Dividido em três partes (decisão: tudo grátis; começar pela integração, sem rede ao vivo).

#### M4.1 — Integração com o Vorterium ✅ (falta aplicar a migration e testar logado)
- `npm run vorterium` gera o motor como biblioteca (`vite.lib.config.ts`, `tsconfig.lib.json`) e
  copia pro Vorterium: código em `src/vendor/vortable`, assets em `public/vortable/assets`
- Vorterium: o Vortable **substitui a transmissão de tela** (apagada). A sub-aba **Mesa** da
  Sessão tem o botão **Entrar no Vortable** (abre `/campanhas/:id/vortable` em tela cheia,
  fora do layout do site, com "Sair" e "Tela cheia") e as **artes recentes** da mesa
  (documentos da Mesa ficam guardados no código, sem uso)
  - **Jogador**: só a tela do jogo com o boneco dele; na primeira vez abre o criador (um boneco só)
  - **Mestre**: *Editar mundo | Testar | Personagens | Jogadores*; em Jogadores troca o boneco
    de cada um (até um criado por ele) ou apaga; bonecos sem jogador listados à parte
- Migrations `20240192_vortable_base` (mundo, zonas, bonecos) e `20240193_vortable_controle`
  (quem **cria** × quem **joga** cada boneco, tempo real); RLS: membro lê, só o mestre mexe no
  mundo e nas zonas, mestre troca/apaga qualquer boneco
- Pontes `WorldStorage` e `CharacterStorage` em Supabase (`vortableService.ts`)
- **Cenas do mestre (estilo OBS)**: barra à direita das abas do mestre — *Ao vivo*, *Preto*,
  *Pausa*, *Imagem* (escolhe uma arte/mapa da Mesa) e *Título* (texto grande) — vale na hora pra
  todos os jogadores (canal Realtime `mesa:<campanha>`); a cena cobre o jogo com fade e trava o
  teclado do boneco (`setInputLocked`); o aviso "Ao vivo" chega aos jogadores quando o mestre
  abre o Vortable
- ⏳ Falta: aplicar a migration no Supabase, testar logado, publicar no Vercel

#### M4.2 — Multiplayer ao vivo ✅ (falta testar com gente de verdade)
- **Transporte grátis**: WebRTC de navegador pra navegador; o navegador do **mestre é o centro**
  (cada jogador abre um DataChannel com ele e ele repassa aos outros). O Supabase só leva a
  conversa de conexão (canal `mesa:<campanha>`); movimento não passa por ele. STUN público; TURN
  só se a rede exigir (`VITE_TURN_*`)
- Motor (`src/engine/net`): `NetHub` (quem está na sala), mensagens `hello / who / state / bye /
  teleport`, bonecos remotos com nome, sombra e suavização, escondidos em outra zona; `net` e
  `receive/resync` em `mountVortable`; teste sem Vorterium em duas abas: `/?jogar&rede=Nome`
- Vorterium (`features/vortable/net`): `VortableNet` (mestre e jogador), ligado ao jogo do
  jogador e ao *Testar* do mestre; aviso "N online" na barra
- Aba **Jogadores** do mestre: bolinha de online, **Levar a… (zona)** e **Expulsar**
- **Controle do mestre** (aba nova, durante a sessão; o *Editar mundo* é a criação antes dela): câmera
  livre sem boneco (`mode: 'watch'`), troca de zona, mapa inteiro, seguir um jogador e **hora / tempo /
  vento ao vivo** pra todos (mensagem `env`, por zona ou todas; quem entra depois recebe); o botão
  *Testar* do editor leva o mestre ao mundo junto com os jogadores
- **Mundos** (botão na barra de cima do Vortable, só o mestre): vários mundos por campanha (cada um é
  um conjunto de zonas; migration `20240194_vortable_mundos`); *Abrir pros jogadores* coloca todos no
  mundo escolhido na hora (tempo real), *Editar* leva o editor pra ele, *+* cria, renomear e apagar
- **Mundo TORVALLEN** (`scripts/torvallen.mjs` → `maps/torvallen.mundo.json`): a Grande Biblioteca do palácio
  em **4 andares** (térreo / Galeria dos Corredores / Arquivos Antigos / Torre dos Pergaminhos), ~1000 objetos
  e 16–39 luzes por andar: blocos de estantes (9×3) separados por becos de 3 tiles, praças de leitura, jardim,
  cantos com lareira, nave com altar e vitral no térreo, átrio no 4º andar. **Seis escadas de degraus** (pacote
  `escadas`, arte própria em `scripts/make-stairs.mjs`) ligam os andares (subir/descer troca de zona); no Vorterium: Mundos → *Mundos prontos* → *Criar este mundo*, ou *Importar mundo*
- Testado: loopback de WebRTC (mestre + 2 jogadores: relay, teleporte, expulsão) e duas abas do motor
- ⏳ Falta: hora/clima do mestre pra todos, zonas em tempo real (mestre editando), chat no balão

#### M4.3 — Ficha, chat e dados (⏳)
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
