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

`?` (ou o link *Atalhos* no rodapé) mostra todos dentro do editor.

| Tecla | Ação |
|---|---|
| roda do mouse (ou pinça do trackpad) | zoom suave, no ponto do cursor (10% a 800%) |
| `Ctrl +` / `Ctrl −` | mais / menos zoom |
| `Ctrl 0` · `Ctrl 1` · `Ctrl 2` | enquadrar a zona · 100% · 200% |
| `Espaço`+arrastar, botão do meio ou direito | mover a tela |
| `WASD` / setas | mover a tela (`Shift` = rápido) |
| `B` / `G` / `E` | pincel / balde / borracha |
| `O` / `V` / `P` | colocar objeto / selecionar e mover / ponto de início |
| `C` | cômodo (arraste; `Ctrl` apaga) |
| `L` | luz solta: clique põe, arraste move; cor, alcance, força e tremor no painel **Clima** |
| `I` | ver iluminação no editor (hora, luzes, sombras) |
| `U` | ouvir os sons da zona no editor |
| `M` (no teste/jogo) | ligar/desligar o som |
| `X` | saída: arraste pra desenhar a área que leva a outra zona; o destino se escolhe no painel |
| `[` `]` ou `Alt`+roda | tamanho do pincel |
| `Shift`+clique (pincel) | linha reta desde o último ponto |
| arrastar (objeto) | carimba vários seguidos; com `Shift`, variantes e espelho sorteados |
| `Shift`/`Ctrl`+clique, arrastar no vazio | somar à seleção / selecionar com retângulo |
| `Ctrl A` · `Ctrl C` · `Ctrl X` · `Ctrl V` · `Ctrl D` | selecionar tudo · copiar · recortar · colar no mouse · duplicar |
| setas (com seleção) | empurrar 1px (`Shift` = 8px) |
| `,` `.` | variante anterior / próxima |
| `F` | espelhar |
| `H` / `K` / `N` | grade / colisões / encaixar na grade |
| `Ctrl+Z` / `Ctrl+Y` | desfazer / refazer |
| `Ctrl+S` | salvar |
| `Del` | apagar a seleção |
| `Alt`+clique | conta-gotas: copia o terreno ou o objeto sob o mouse |
| `Esc` | soltar a seleção / sair do teste |

### Mundo e zonas

- Cada zona é um pedaço do mundo; só a zona atual fica carregada.
- **Saídas** (ferramenta `X`) levam a outra zona. No painel, escolha *Leva para* e *Chega em*;
  **Ligar ida e volta** faz a saída de lá trazer de volta (e cria uma, se não existir).
- **Mundo** (barra de cima) mostra o mapa do mundo: zonas como cartões, setas pras saídas,
  ★ = onde os jogadores começam. Arraste os cartões pra organizar.
- **Nova → Interior** cria uma zona pequena com fundo escuro; use os terrenos de *Interior*
  (pisos, tapetes, paredes).

### Cômodos (interiores estilo Stardew)

Aba **Cômodos** (ou tecla `C`) — funciona em zona de interior (fundo *Vazio*) ou de exterior:
- **Cômodo**: arraste um retângulo e sai pronto — piso, parede com face em cima, moldura escura
  em volta. Encostado num cômodo de outro estilo, nasce uma parede fina entre os dois; do mesmo
  estilo, vira um cômodo maior.
- **Parede**: risque uma linha dentro do cômodo pra dividir.
- **Porta**: arraste sobre uma parede (ou na borda de baixo, pra entradinha) pra abrir um vão.
- **Clique** num cômodo aplica o estilo escolhido; **Alt + clique** copia o estilo; **Ctrl +
  arrastar** apaga.
- Estilo = parede (252) + piso + moldura (32) + altura da parede (0 = só a borda, pra
  corredores de castelo/masmorra). Há estilos prontos (casa de fazenda, taverna, castelo...).

### Luz, hora, tempo, sombras e vento

Aba **Clima**:
- **Ambientes prontos**: Ciclo dia/noite, Dia, Entardecer, Semi noite, Noite, Interior, Taverna à noite, Caverna, Masmorra.
- **Onde fica**: *ar livre* (o céu muda de cor com a hora e o sol faz sombra), *interior* (mais
  escuro; de dia entra um facho de sol pelas janelas) ou *subterrâneo* (nunca vê o sol; escolha a
  cor do escuro).
- **Hora**: *ciclo* (corre sozinha, mesmo relógio pro mundo todo; um dia dura 12–96 min) ou
  *fixa* (a taverna é sempre noite). No ciclo, a régua escolhe que hora ver no editor — e o teste
  começa nela.
- **Luzes**: tochas, velas, lampiões, lareiras e fogueiras dos Objetos já vêm acesos. A ferramenta
  `L` põe luz solta (cores prontas: fogo, vela, luar, magia, veneno...).
- As paredes dos cômodos **barram a luz** (uma tocha não clareia o cômodo vizinho; passa pela
  porta). Janelas acendem à noite vistas de fora; lava e água venenosa brilham no escuro.
- **Tempo**: limpo, nublado, neblina, garoa, chuva, tempestade, neve leve, neve, nevasca. No
  encoberto as nuvens passam por cima do mapa e a sombra delas corre pelo chão; a chuva cai
  inclinada pelo vento e respinga; a tempestade relampeja (em interiores, pisca nas janelas); a
  neve flutua e pousa; nevasca e neblina passam como névoa.
- **Vento** (ao ar livre: parado, brisa ou ventania): árvores, arbustos, flores e plantações
  balançam (placas e lamparinas penduradas balançam presas no topo); os tufinhos da grama do
  chão balançam com as rajadas e chacoalham quando alguém passa por cima; folhas caem das copas
  (com a cor da própria árvore) e o vento as leva rolando pelo chão; sombra de nuvens passa pelo
  mapa.
- **Horas do dia**: o ciclo percorre amanhecer (rosa e ouro, névoa e orvalho), manhã, meio-dia
  (manchas de sol entre as folhas), tarde, pôr do sol (raios de luz fixos no cenário, sombras
  roxas, pássaros), semi noite (gradiente do pôr do sol para a noite) e noite de luar (sombras
  azuis da lua, névoa fria). A noite começa às 19h e fecha às 20h; o crepúsculo corre a 1/3 da
  velocidade no relógio real pra a luz mudar devagar.
- Partículas: chamas em toda tocha, lareira e fogueira; faíscas e fumaça nas grandes; vaga-lumes à
  noite; poeira no ar dos interiores; reflexos piscando na água.
- No editor, `I` liga/desliga a prévia (pra pintar no claro).

### Sons

Gravações livres (créditos na tela de Créditos): ambientes do *Nature Ambient Pack* (JC Sounds,
CC BY 4.0), passos *Impact Sounds* (Kenney, CC0) e *Footsteps on different surfaces*
(congusbongus, CC BY 3.0), trovão de Jerimee (CC BY 3.0). Aba **Sons**:
- **Automático** (padrão): floresta onde há árvores (pássaros de dia, grilos à noite), vento,
  chuva/tempestade/neve conforme o tempo, um trovão a cada relâmpago; fogueira, tocha, lago e
  pântano quando o jogador chega perto. Dentro de casa o de fora soa abafado.
- **15 camadas** em cartões (clique liga/desliga e mostra o volume): Floresta, Sombria, Vento,
  Chuva, Tempestade, Trovões (também sem chuva), Neve, Riacho, Lago, Cachoeira, Pântano, Mar,
  Caverna, Fogueira, Tocha.
- **Passos** gravados por chão: grama, terra, areia, cascalho, neve, pedra, madeira, tapete, água.

### Terrenos, paredes, tapetes e cercas

- **Paredes**: pinte uma faixa de 3 tiles de altura com um terreno de *Paredes* (sai moldura,
  face e rodapé); em volta do cômodo, pinte uma **moldura de teto** por cima da sala inteira.
- **Camada de cima** (molduras de teto e tapetes): pinta por cima do piso. Com um desses
  escolhido, borracha e balde agem só nessa camada.
- **Cercas**: pinte o caminho com o pincel; cada pedaço se liga aos vizinhos sozinho.
- A busca no topo da aba acha por nome ou família ("tijolo", "tapete", "madeira").

### Objetos

- Quatro tipos: **em pé** (árvore, armário: o boneco passa na frente ou atrás), **no chão**
  (tapete: sempre por baixo), **na parede** (placa, tocha) e **por cima** (copa, telhado: fica
  transparente quando o boneco passa embaixo). Árvores e móveis altos também ficam
  transparentes quando escondem o boneco.
- Peças com **variantes** (cores da árvore, baú fechado/aberto) aparecem uma vez na paleta;
  troque a variante no painel da peça, inclusive de um objeto já colocado.
- **Altura** (objeto selecionado): ▲/▼ sobe a peça pra cima de uma mesa ou balcão; quem
  decide quem fica na frente é o ponto no chão.
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
