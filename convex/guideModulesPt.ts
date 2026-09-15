import type { GuideModuleSeed } from "./guideModulesEn";

/**
 * GUIDE « Comment ça marche » — JEU PORTUGAIS BRÉSILIEN (locale « pt »).
 *
 * Traduit du jeu ANGLAIS tel qu'il vit en prod au 2026-09-15 (warm-up fusionné
 * compris), pas du seed `guideModulesEn.ts` : le warm-up a été réécrit depuis
 * (`migrations:fuseWarmupGuide`). Portugais du Brésil, « você », même voix que
 * `messages/pt.json` (« missão », « aquecimento », « visualizações »).
 *
 * Un jeu par langue (cf convex/guideModuleLocale.ts) : ces modules n'altèrent ni
 * le français ni l'anglais. Posés par `migrations:seedGuideModulesLocale`.
 *
 * ADAPTÉ — paiement : le texte anglais s'adresse à une créatrice US (« skip
 * SEPA, it won't work with a US bank »). La consigne dit ici à qui sert SEPA,
 * sans présumer du pays (Brésil comme Portugal).
 *
 * Le module warm-up porte `slot: "warmup"` : c'est lui qu'ouvre le bouton
 * « Guide warmup » du tracker, dans la langue de la lectrice.
 */

const WARMUP_INTRO = `O aquecimento é a etapa mais importante se você quer que seus vídeos sejam vistos. Mesmo com os melhores vídeos do mundo, se sua conta não estiver bem aquecida, o algoritmo não vai impulsioná-los. Pior: você pode levar shadowban, e suas visualizações ficam travadas em zero.

**A duração do seu aquecimento aparece no tracker**, conta por conta, junto com o número de tarefas já marcadas. É isso que vale: depende do projeto, um admin pode ajustar, e é essa contagem que seu progresso segue. Então leia as fases abaixo como proporções, não como datas.

## Regras gerais

- Um email próprio por conta, sem aliases com \`+\`.
- Só o app nativo no celular, durante o aquecimento e nos seus 10 primeiros posts: nada de web, API ou agendador.
- Sem VPN, e coerência geográfica rigorosa: aparelho, chip e IP no mesmo país.
- Perfil mínimo nos primeiros dias: sem bio de vendas, sem link externo agressivo.
- Interaja só dentro do seu nicho, desde o primeiro dia.`;

const WARMUP_DAILY = `- **Pesquisas diárias com as SUAS palavras-chave** na barra de pesquisa.
- De 15 a 30 min por dia rolando o feed, dentro do seu nicho.
- Assista aos vídeos do seu nicho **até o fim**, sem passar rápido.
- De 10 a 20 curtidas por dia, e 2 ou 3 comentários de verdade (não “🔥”).
- **De 5 a 10 follows por dia, no máximo**, em contas do seu nicho.`;

const WARMUP_RAMP = `### Como evolui, ao longo do SEU aquecimento

- **No começo**: principalmente observe. Pesquisas, rolagem, algumas curtidas e só: zero follows, zero comentários.
- **Depois**: interaja com calma. É aqui que entram os follows e seus primeiros comentários de verdade.
- **Perto do fim**: atividade normal. Salve os posts que importam: é um sinal forte.
- Preencha sua bio e sua foto de perfil nessa etapa.`;

const warmupFirstPost = (thing: string, heading: string) => `### ${heading}: no dia seguinte à sua última tarefa

- **Não publique nada até o tracker mostrar seu aquecimento concluído.** Um dia sem marcar adia o fim em um dia: o que conta é o número de tarefas marcadas, não o tempo que passou.
- Depois, 1 ${thing} por dia durante uma semana a dez dias antes de acelerar o ritmo.`;

const WARMUP_TIKTOK = `## TikTok

### Durante todo o aquecimento: você não publica nada

${WARMUP_DAILY}

${WARMUP_RAMP}

${warmupFirstPost("post", "Seu primeiro post")}`;

const WARMUP_INSTAGRAM = `## Instagram

### Configuração

- Crie a conta e deixe o perfil vazio no começo.
- Adicione sua bio, sua foto de perfil e um destaque durante o aquecimento.

### Durante todo o aquecimento: você não publica nada

${WARMUP_DAILY}
- Curta e **salve** Reels do seu nicho.

${WARMUP_RAMP}

${warmupFirstPost("Reel", "Seu primeiro Reel")}`;

const WARMUP_YOUTUBE = `## YouTube Shorts

O YouTube é bem mais permissivo: a conta fica ligada à sua conta Google já existente, então levanta menos suspeitas.

### Configuração

- Banner, foto de perfil, descrição do canal e página “Sobre” completa.
- Crie uma playlist, mesmo que vazia.
- Coloque o link das suas outras contas na descrição.

### Durante todo o aquecimento: você não publica nada

${WARMUP_DAILY}
- 1 ou 2 vídeos longos por dia do seu nicho: um sinal forte para o YouTube.

${WARMUP_RAMP}

${warmupFirstPost("Short", "Seu primeiro Short")}`;

const WARMUP_RETENTION = `## O que realmente importa para decolar

O aquecimento evita que você seja sinalizada, mas não é o que faz suas visualizações decolarem. O que libera o alcance hoje é a **retenção**:

- **O hook dos 3 primeiros segundos.** O algoritmo observa se as pessoas ficam depois dos primeiros segundos. Com um hook fraco, o vídeo é testado e depois abandonado. Fique obcecada pelos seus 3 primeiros segundos acima de tudo.
- **Taxa de conclusão.** Faça as pessoas assistirem seu vídeo até o fim, ou assistirem de novo. É o sinal número um: um vídeo curto assistido até o fim ganha de um longo que as pessoas largam no meio.
- **Compartilhamentos e salvamentos.** Valem mais que curtidas. Dê às pessoas um motivo para salvar ou compartilhar.`;

const warmupCheck = (platformLines: string) => `## Confira se sua conta está limpa

Quando seu primeiro post estiver no ar, estes sinais mostram se o aquecimento funcionou:

${platformLines}

### Os sinais de alerta

- Visualizações travadas entre 0 e 50, ou exatamente 200 várias vezes seguidas.
- Tráfego Para Você / feed de Reels / feed de Shorts em 0% nas suas estatísticas.
- Um vídeo preso em “Processando” por mais de 2 horas.
- Um aviso de “Ação bloqueada” no Instagram.
- Posts visíveis só para quem já te segue.
- Uma notificação de “Não qualificado para o feed Para Você” (TikTok).
- Uma queda de 70% ou mais em relação à sua média de 28 dias.`;

const WARMUP_OUTRO = `## Se o aquecimento falhou

1. **Pare de publicar imediatamente.** É o mais importante.
2. Faça uma pausa de 5 a 7 dias, mas **ativa**: role o feed do seu nicho de 20 a 30 min por dia, sem publicar nada.
3. Publique UM vídeo de novo e veja o que acontece.
4. Continua com zero visualizações? Abandone a conta e crie uma nova.

**Não apague os vídeos que não foram bem.** Apagar manda um sinal ruim e pode acionar os filtros antispam. Se quiser tirar um de vista, deixe como **Somente eu** no TikTok ou **arquive** no Instagram em vez de apagar.

## O que NÃO fazer

### Durante o aquecimento

- Publicar antes de o tracker mostrar o aquecimento concluído.
- Seguir 50 contas no primeiro dia.
- Soltar comentários genéricos (“top”, “🔥”).
- Interagir fora do seu nicho: isso confunde a classificação da sua conta.
- Mudar a bio ou a foto de perfil todo dia.
- Ficar trocando de VPN ou de IP.

### No lançamento, logo depois do aquecimento

- Soltar 3 vídeos de uma vez.
- Usar agendador ou API nos seus 10 primeiros posts.
- Hashtags duvidosas ou banidas: sempre confira na barra de pesquisa.
- Isca de engajamento (“curta se concorda”, “me segue para a parte 2”): sinalização imediata.
- Música com direitos autorais numa conta comercial.
- Publicar **o mesmo arquivo de vídeo** em várias contas: a impressão digital do arquivo é detectada.

### Sempre

- Parar de rolar a plataforma quando já está no modo publicação: o algoritmo também acompanha o que você consome.
- Publicar em excesso depois de um viral: passar de 1 para 10 posts por dia é um sinal de alerta.
- Ficar pulando de uma conta para outra a cada dez minutos.

## Bom saber também

- **Tenha paciência.** Uma conta nova leva tempo para ganhar a confiança do algoritmo. Seus primeiros vídeos podem não ter muitas visualizações: é normal, principalmente nas 2-3 primeiras semanas. Não julgue rápido demais.
- **Não deixe seu conteúdo parecer automático ou repetitivo.** As plataformas impulsionam menos o conteúdo feito em série. Coloque seu toque e varie seus hooks.`;

const CHECK_TIKTOK_INSTAGRAM = `- **TikTok, visualizações do primeiro post em 6 h**: de 200 a mais de 500.
- **TikTok, fonte de tráfego Para Você** (Estatísticas → Alcance): mais de 30%, idealmente mais de 50%.
- **Instagram, visualizações do Reel em 24 h**: de 200 a mais de 1.000.
- **Instagram, alcance de não seguidores**: mais de 40%.`;

const PAYMENT_CURRENCY = `**Como é o pagamento.** Tudo é pago em **dólares americanos**. No seu perfil, escolha **PayPal**, **USDT (cripto)** ou **Outro** e diga como prefere receber. A opção SEPA só serve para contas bancárias da zona SEPA (Europa).`;

const REPACKIT_PT: GuideModuleSeed[] = [
  {
    order: 0,
    title: "Boas-vindas e como funciona",
    contentMarkdown: `**Boas-vindas ao time de criadores da RepackIt 👋**

A RepackIt é a ferramenta que ajuda YouTubers a criar thumbnails e hooks em que as pessoas realmente clicam. Seu trabalho: fazer vídeos curtos que mostrem e expliquem o que a RepackIt faz, para que os criadores venham conhecer a ferramenta.

**Veja como funciona, passo a passo:**

1. **Você cria suas contas** nas redes (TikTok, Instagram, YouTube): o usuário exato que você deve usar aparece no app.
2. **Você aquece suas contas** por alguns dias antes de publicar qualquer coisa. Não é opcional, e tem um módulo inteiro sobre isso.
3. **Você recebe suas missões** no app: cada uma diz qual vídeo fazer, com o roteiro e as orientações.
4. **Você faz o vídeo e envia** direto na missão, depois que ele estiver no ar na sua conta.
5. **Você recebe** conforme suas visualizações, acompanhadas automaticamente no app.

Tudo acontece aqui, neste app. Suas contas, suas missões, suas visualizações, seus ganhos: você acompanha tudo pelo seu espaço. Ficou com alguma dúvida? Pergunte.

Leia todos os módulos com calma antes de começar. Eles vão te poupar dos erros que custam visualizações (ou uma conta).`,
  },
  {
    order: 1,
    title: "Como você recebe",
    contentMarkdown: `Na RepackIt você recebe por CPM, ou seja, pelas visualizações que seus vídeos geram. Seu acordo tem três partes:

- **Uma base fixa**: um valor garantido por um volume definido de vídeos.
- **Uma parte variável por visualizações**: um valor a cada 1.000 visualizações dos seus vídeos.
- **Níveis de bônus**: recompensas que você desbloqueia ao atingir certos totais de visualizações acumuladas.

**Os números exatos do SEU acordo** (sua base, sua tarifa por visualizações, seus níveis) estão no seu contrato. Você também vê uma estimativa dos seus ganhos direto em cada missão no app.

**Como é acompanhado**: quando seu vídeo está no ar e foi enviado no app, puxamos as visualizações automaticamente. Seus ganhos são atualizados conforme o vídeo acumula visualizações. Você não precisa calcular nada: está tudo no seu espaço, em Ganhos.

**Duas condições simples para receber:**

- Seu vídeo precisa seguir as regras de conteúdo (veja o módulo Regras e requisitos de publicação).
- Você precisa enviar o link do vídeo no app depois de publicar, para podermos acompanhar as visualizações.

Adicione seus dados de pagamento no perfil assim que começar a ganhar; senão não conseguimos enviar o que você tem a receber.

${PAYMENT_CURRENCY}`,
  },
  {
    order: 2,
    title: "Criar suas contas",
    contentMarkdown: `Antes de produzir qualquer coisa, você precisa de contas limpas nas redes.

**Etapa 1: crie contas novas**

Crie contas novas no TikTok, no Instagram e no YouTube (conforme o que for pedido). Comece com contas em branco, não com uma conta pessoal que você já tenha.

**Etapa 2: use o usuário (@) certo**

O usuário exato para criar em cada plataforma **aparece no app** (no seu espaço, em “Crie estas contas nas suas redes”). Crie exatamente esse usuário em cada plataforma e depois cadastre a conta no app. Isso é importante: é assim que acompanhamos seus vídeos e suas visualizações.

**Etapa 3: foto de perfil e bio**

- Coloque uma foto de perfil limpa, que combine com a RepackIt.
- Mencione **@repackit.io** na bio de todas as contas.

**Etapa 4: configurações básicas**

Vincule um email e um número de telefone a cada conta. Isso deixa a conta com cara de legítima para as plataformas e reduz o risco de ter o alcance limitado.

**Etapa 5: cadastre suas contas no app**

Quando suas contas existirem, cadastre-as no seu espaço. É isso que liga suas contas às suas missões e permite acompanhar as visualizações.

Contas prontas e cadastradas? **Ainda não publique.** Vá para o módulo de aquecimento.`,
  },
  {
    order: 3,
    slot: "warmup",
    title: "Aquecimento e como evitar shadowban",
    contentMarkdown: `${WARMUP_INTRO}

${WARMUP_TIKTOK}

${WARMUP_INSTAGRAM}

${WARMUP_YOUTUBE}

${WARMUP_RETENTION}

${warmupCheck(`${CHECK_TIKTOK_INSTAGRAM}
- **YouTube, visualizações do Short em 48 h**: de 100 a mais de 500.
- **YouTube, fonte “feed de Shorts”**: presente.
- **As 3 plataformas, teste com uma hashtag única**: seu vídeo é encontrado a partir de outra conta.
- **As 3 plataformas, seu próprio feed ficou focado no nicho**: sim.`)}

${WARMUP_OUTRO}`,
  },
  {
    order: 4,
    title: "Regras e requisitos de publicação",
    contentMarkdown: `Estas são as regras que seus vídeos precisam seguir para serem validados e pagos. **Se você não seguir, não recebe.**

**Conteúdo:**

- Todo vídeo precisa **marcar @repackit.io** na plataforma correspondente.
- Você precisa **mencionar @repackit.io na bio** da conta em que publica.
- **Duração mínima: 10 segundos** por vídeo.

**Qualidade:**

- Seus vídeos precisam seguir as orientações e o roteiro de cada missão.
- Nada de trapaça: visualizações e engajamento nunca podem ser inflados artificialmente (bots são proibidos, e a gente pega).

**Envio:**

- Quando seu vídeo estiver no ar, **envie o link dele no app** (na missão correspondente) para podermos acompanhar as visualizações. Faça isso logo depois de publicar.

Seguindo isso, está tudo certo. Estamos juntos nessa: você faz um bom conteúdo e recebe pelas suas visualizações. Dúvidas? Estamos por aqui 24/7!`,
  },
];

const SNYTCH_PT: GuideModuleSeed[] = [
  {
    order: 0,
    title: "Boas-vindas e como funciona",
    contentMarkdown: `**Boas-vindas ao time de criadores da Snytch 👋**

A Snytch é o app da Geração Z para acompanhar o que acontece numa conta do Instagram: novos seguidores, quem deixou de seguir, quem mais interage com você, tanto em contas privadas quanto públicas.

Seu trabalho: fazer vídeos curtos que mostrem e expliquem o que a Snytch faz, para que as pessoas venham experimentar o app.

**Veja como funciona, passo a passo:**

1. **Você cria suas contas** nas redes (TikTok e Instagram): o usuário exato que você deve usar aparece no app.
2. **Você aquece suas contas** por 3 dias antes de publicar qualquer coisa. Não é opcional, e tem um módulo inteiro sobre isso.
3. **Você recebe suas missões** no app: cada uma diz qual vídeo fazer, com o roteiro e as orientações.
4. **Você faz o vídeo e envia** direto na missão, depois que ele estiver no ar na sua conta.
5. **Você recebe** conforme seu contrato e suas visualizações, acompanhadas automaticamente no app.

Tudo acontece aqui, neste app. Suas contas, suas missões, suas visualizações, seus ganhos: você acompanha tudo pelo seu espaço. Ficou com alguma dúvida? Fale com o Anthony no WhatsApp (+33617176306)

Leia todos os módulos com calma antes de começar. Eles vão te poupar dos erros que custam visualizações (ou uma conta).`,
  },
  {
    order: 1,
    title: "Como você recebe",
    contentMarkdown: `Na Snytch, o que seu contrato cobre depende do seu acordo: só visualizações, ou um valor fixo mais uma parte por visualizações. Estas são as duas partes que acompanham suas visualizações:

- **Uma parte variável por visualizações**: um valor a cada 1.000 visualizações dos seus vídeos.
- **Níveis de bônus**: recompensas que você desbloqueia ao atingir certos totais de visualizações acumuladas.

**Os números exatos do SEU acordo** (sua tarifa por visualizações, seus níveis) estão no seu contrato. Você também vê uma estimativa dos seus ganhos direto em cada missão no app.

**Como é acompanhado**: quando seu vídeo está no ar e foi enviado no app, puxamos as visualizações automaticamente. Seus ganhos são atualizados conforme o vídeo acumula visualizações. Você não precisa calcular nada: está tudo no seu espaço, em Ganhos.

**Duas condições simples para receber:**

- Seu vídeo precisa seguir as regras de conteúdo (veja o módulo Regras e requisitos de publicação).
- Você precisa enviar o link do vídeo no app depois de publicar, para podermos acompanhar as visualizações.

Adicione seus dados de pagamento no perfil assim que começar a ganhar; senão não conseguimos enviar o que você tem a receber.

${PAYMENT_CURRENCY}`,
  },
  {
    order: 2,
    title: "Criar suas contas",
    contentMarkdown: `Antes de produzir qualquer coisa, você precisa de contas limpas nas redes.

**Etapa 1: crie contas novas**

Crie contas novas no TikTok e no Instagram (conforme o que for pedido). Comece com contas em branco, não com uma conta pessoal que você já tenha.

**Etapa 2: use o usuário (@) certo**

O usuário exato para criar em cada plataforma **aparece no app** (no seu espaço, em “Crie estas contas nas suas redes”). Crie exatamente esse usuário em cada plataforma e depois cadastre a conta no app. Isso é importante: é assim que acompanhamos seus vídeos e suas visualizações.

**Etapa 3: foto de perfil e bio**

- Coloque uma foto de perfil limpa, com cara de pessoa comum.
- Mencione o site **snytch.co** na bio de todas as contas.

**Etapa 4: configurações básicas**

Vincule um email e um número de telefone a cada conta. Isso deixa a conta com cara de legítima para as plataformas e reduz o risco de ter o alcance limitado.

**Etapa 5: cadastre suas contas no app**

Quando suas contas existirem, cadastre-as no seu espaço. É isso que liga suas contas às suas missões e permite acompanhar as visualizações.

Contas prontas e cadastradas? **Ainda não publique.** Vá para o módulo de aquecimento.`,
  },
  {
    order: 3,
    slot: "warmup",
    title: "Aquecimento e como evitar shadowban",
    contentMarkdown: `${WARMUP_INTRO}

${WARMUP_TIKTOK}

${WARMUP_INSTAGRAM}

${WARMUP_RETENTION}

${warmupCheck(`${CHECK_TIKTOK_INSTAGRAM}
- **As duas plataformas, teste com uma hashtag única**: seu vídeo é encontrado a partir de outra conta.
- **As duas plataformas, seu próprio feed ficou focado no nicho**: sim.`)}

${WARMUP_OUTRO}`,
  },
  {
    order: 4,
    title: "Condições de pagamento dos criadores",
    contentMarkdown: `**Condições de pagamento dos criadores**

Para receber pelo trabalho, todos os criadores parceiros precisam cumprir todos os compromissos definidos na colaboração.

O pagamento depende de todos os pontos a seguir:

* Entregar cada post solicitado dentro dos prazos combinados.
* Seguir as orientações, os formatos, os requisitos de conteúdo e as datas de publicação informados para a campanha.
* Ter o conteúdo aprovado com antecedência pelos responsáveis, donos ou fundadores do site antes de qualquer publicação.
* Concluir todas as publicações previstas durante todo o mês em questão.

A aprovação final do trabalho entregue fica a critério exclusivo dos responsáveis, donos e fundadores do site.

Você pode consultar o contrato assinado para ver as condições exatas de pagamento.`,
  },
  {
    order: 5,
    title: "Regras e requisitos de publicação",
    contentMarkdown: `Estas são as regras que seus vídeos precisam seguir para serem validados e pagos. **Se você não seguir, não recebe.**

**Conteúdo:**

- Todo vídeo **precisa marcar a conta da Snytch** na plataforma correspondente, onde o roteiro indicar.
- Você precisa **mencionar Snytch.co na bio** da conta em que publica.
- **Duração mínima: 10 segundos** por vídeo.

**Qualidade:**

- Seus vídeos precisam seguir as orientações e o roteiro de cada missão.
- Nada de trapaça: visualizações e engajamento nunca podem ser inflados artificialmente (bots são proibidos, e a gente pega :)).

**Envio:**

- Quando seu vídeo estiver no ar, envie o link dele no app (na missão correspondente) para podermos acompanhar as visualizações. Faça isso logo depois de publicar.

**Seguindo isso, está tudo certo.** Estamos juntos nessa: você faz um bom conteúdo e recebe pelas suas visualizações. Dúvidas? É só perguntar ao Anthony: estamos por aqui 24/7!`,
  },
];

/** Les deux jeux, par slug de projet — la migration n'en connaît pas d'autre. */
export const GUIDE_MODULES_PT: Record<string, GuideModuleSeed[]> = {
  repackit: REPACKIT_PT,
  snytch: SNYTCH_PT,
};
