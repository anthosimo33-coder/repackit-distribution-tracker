import type { GuideModuleSeed } from "./guideModulesEn";

/**
 * GUIDE « Comment ça marche » — JEU ESPAGNOL (locale « es »).
 *
 * Traduit du jeu ANGLAIS tel qu'il vit en prod au 2026-09-15 (warm-up fusionné
 * compris), pas du seed `guideModulesEn.ts` : le warm-up a été réécrit depuis
 * (`migrations:fuseWarmupGuide`). Espagnol neutre, tutoiement, même voix que
 * `messages/es.json` (« misión », « calentamiento », « vistas »).
 *
 * Un jeu par langue (cf convex/guideModuleLocale.ts) : ces modules n'altèrent ni
 * le français ni l'anglais. Posés par `migrations:seedGuideModulesLocale`.
 *
 * ADAPTÉ — paiement : le texte anglais s'adresse à une créatrice US (« skip
 * SEPA, it won't work with a US bank »). Une créatrice hispanophone peut être en
 * Espagne (SEPA valable) comme en Amérique latine (SEPA inutilisable) : la
 * consigne dit donc à qui sert SEPA, sans présumer du pays.
 *
 * Le module warm-up porte `slot: "warmup"` : c'est lui qu'ouvre le bouton
 * « Guide warmup » du tracker, dans la langue de la lectrice.
 */

const WARMUP_INTRO = `El calentamiento es el paso más importante si quieres que tus vídeos se vean. Aunque tengas los mejores vídeos del mundo, si tu cuenta no está bien calentada, el algoritmo no los va a empujar. Peor aún: te pueden hacer shadowban y tus vistas se quedarán bloqueadas en cero.

**La duración de tu calentamiento aparece en el tracker**, cuenta por cuenta, junto con el número de tareas ya marcadas. Es lo que manda: depende del proyecto, un admin puede ajustarla y tu progreso sigue esa cuenta atrás. Así que lee las fases de abajo como proporciones, no como fechas.

## Reglas comunes

- Un email propio por cuenta, sin alias con \`+\`.
- Solo la app móvil nativa, durante el calentamiento y tus 10 primeros posts: nada de web, API ni programador de publicaciones.
- Sin VPN y con coherencia geográfica estricta: dispositivo, SIM e IP en el mismo país.
- Perfil mínimo los primeros días: sin bio comercial ni enlace externo agresivo.
- Interactúa solo dentro de tu nicho, desde el primer día.`;

const WARMUP_DAILY = `- **Búsquedas diarias con TUS palabras clave** en la barra de búsqueda.
- De 15 a 30 min al día deslizando tu feed, dentro de tu nicho.
- Mira los vídeos de tu nicho **hasta el final**, sin pasar rápido.
- De 10 a 20 likes al día, y 2 o 3 comentarios de verdad (no «🔥»).
- **De 5 a 10 follows al día, como máximo**, a cuentas de tu nicho.`;

const WARMUP_RAMP = `### Cómo avanza, a lo largo de TU calentamiento

- **Al principio**: sobre todo observa. Búsquedas, scroll, algunos likes y nada más: cero follows, cero comentarios.
- **Después**: interactúa con suavidad. Aquí van los follows y tus primeros comentarios de verdad.
- **Hacia el final**: actividad normal. Guarda los posts que te interesen: es una señal fuerte.
- Completa tu bio y tu foto de perfil durante esta etapa.`;

const warmupFirstPost = (thing: string, heading: string) => `### ${heading}: el día después de tu última tarea

- **No publiques nada hasta que el tracker marque tu calentamiento como terminado.** Un día sin marcar retrasa el final un día: lo que cuenta es el número de tareas marcadas, no el tiempo que pasa.
- Después, 1 ${thing} al día durante una semana o diez días antes de subir el ritmo.`;

const WARMUP_TIKTOK = `## TikTok

### Durante todo el calentamiento: no publicas nada

${WARMUP_DAILY}

${WARMUP_RAMP}

${warmupFirstPost("post", "Tu primer post")}`;

const WARMUP_INSTAGRAM = `## Instagram

### Configuración

- Crea la cuenta y deja el perfil vacío al principio.
- Añade tu bio, tu foto de perfil y una historia destacada durante el calentamiento.

### Durante todo el calentamiento: no publicas nada

${WARMUP_DAILY}
- Da like y **guarda** Reels de tu nicho.

${WARMUP_RAMP}

${warmupFirstPost("Reel", "Tu primer Reel")}`;

const WARMUP_YOUTUBE = `## YouTube Shorts

YouTube es mucho más permisivo: la cuenta va ligada a tu cuenta de Google ya existente, así que despierta menos sospechas.

### Configuración

- Banner, foto de perfil, descripción del canal y sección «Acerca de» completa.
- Crea una lista de reproducción, aunque esté vacía.
- Enlaza tus otras cuentas en la descripción.

### Durante todo el calentamiento: no publicas nada

${WARMUP_DAILY}
- 1 o 2 vídeos largos al día de tu nicho: una señal fuerte para YouTube.

${WARMUP_RAMP}

${warmupFirstPost("Short", "Tu primer Short")}`;

const WARMUP_RETENTION = `## Lo que de verdad importa para despegar

El calentamiento evita que te marquen, pero no es lo que hace que tus vistas despeguen. Lo que hoy desbloquea el alcance es la **retención**:

- **El hook de los 3 primeros segundos.** El algoritmo mira si la gente se queda más allá de los primeros segundos. Con un hook flojo, el vídeo se prueba y luego se abandona. Obsesiónate con tus 3 primeros segundos por encima de todo.
- **La tasa de finalización.** Busca que la gente vea tu vídeo hasta el final o lo vuelva a ver. Es la señal número uno: un vídeo corto visto hasta el final gana a uno largo que la gente deja a la mitad.
- **Compartidos y guardados.** Cuentan más que los likes. Dale a la gente un motivo para guardar o compartir.`;

const warmupCheck = (platformLines: string) => `## Comprueba que tu cuenta está limpia

Cuando tu primer post esté publicado, estas señales te dicen si el calentamiento ha funcionado:

${platformLines}

### Las señales de alarma

- Vistas bloqueadas entre 0 y 50, o exactamente 200 una y otra vez.
- Tráfico Para ti / feed de Reels / feed de Shorts al 0 % en tus estadísticas.
- Un vídeo atascado en «Procesando» durante más de 2 horas.
- Un aviso de «Acción bloqueada» en Instagram.
- Posts visibles solo para tus seguidores actuales.
- Una notificación de «No apto para el feed Para ti» (TikTok).
- Una caída del 70 % o más frente a tu media de 28 días.`;

const WARMUP_OUTRO = `## Si el calentamiento ha fallado

1. **Deja de publicar inmediatamente.** Es lo más importante.
2. Tómate una pausa de 5 a 7 días, pero **activa**: haz scroll en tu nicho de 20 a 30 min al día, sin publicar nada.
3. Vuelve a publicar UN vídeo y observa qué pasa.
4. ¿Sigue en cero vistas? Abandona la cuenta y crea una nueva.

**No borres los vídeos que no funcionan.** Borrar envía una mala señal y puede activar los filtros antispam. Si quieres ocultar uno, ponlo en **Solo yo** en TikTok o **archívalo** en Instagram en lugar de borrarlo.

## Lo que NO hay que hacer

### Durante el calentamiento

- Publicar antes de que el tracker marque el calentamiento como terminado.
- Seguir a 50 cuentas el primer día.
- Soltar comentarios genéricos («genial», «🔥»).
- Interactuar fuera de tu nicho: confunde la clasificación de tu cuenta.
- Cambiar la bio o la foto de perfil todos los días.
- Saltar entre VPN o entre IP.

### En el lanzamiento, justo después del calentamiento

- Subir 3 vídeos de golpe.
- Usar un programador o una API en tus 10 primeros posts.
- Hashtags dudosos o prohibidos: compruébalos siempre en la barra de búsqueda.
- Cebos de interacción («dale like si estás de acuerdo», «sígueme para la parte 2»): marca inmediata.
- Música con derechos de autor en una cuenta de empresa.
- Publicar **el mismo archivo de vídeo** en varias cuentas: la huella del archivo se detecta.

### Siempre

- Dejar de hacer scroll en la plataforma cuando ya estás publicando: el algoritmo también sigue tu consumo.
- Publicar en masa después de un éxito: pasar de 1 a 10 posts al día es una señal de alarma.
- Saltar de una cuenta a otra cada diez minutos.

## También conviene saber

- **Ten paciencia.** Una cuenta nueva necesita tiempo para ganarse la confianza del algoritmo. Puede que tus primeros vídeos no tengan muchas vistas: es normal, sobre todo las 2-3 primeras semanas. No juzgues demasiado rápido.
- **Que tu contenido no parezca automático ni repetitivo.** Las plataformas empujan menos el contenido producido en serie. Ponle tu toque y varía tus hooks.`;

const CHECK_TIKTOK_INSTAGRAM = `- **TikTok, vistas de tu primer post a las 6 h**: de 200 a más de 500.
- **TikTok, fuente de tráfico Para ti** (Estadísticas → Alcance): más del 30 %, idealmente más del 50 %.
- **Instagram, vistas del Reel a las 24 h**: de 200 a más de 1.000.
- **Instagram, alcance entre no seguidores**: más del 40 %.`;

const PAYMENT_CURRENCY = `**Cómo se paga.** Todo se paga en **dólares estadounidenses**. En tu perfil, elige **PayPal**, **USDT (cripto)** u **Otro** e indícanos cómo prefieres cobrar. La opción SEPA solo sirve para cuentas bancarias de la zona SEPA (Europa).`;

const REPACKIT_ES: GuideModuleSeed[] = [
  {
    order: 0,
    title: "Bienvenida y cómo funciona",
    contentMarkdown: `**Te damos la bienvenida al equipo de creadores de RepackIt 👋**

RepackIt es la herramienta que ayuda a los YouTubers a crear miniaturas y hooks en los que la gente hace clic de verdad. Tu trabajo: hacer vídeos cortos que muestren y expliquen lo que hace RepackIt, para que los creadores vengan a descubrir la herramienta.

**Así funciona, paso a paso:**

1. **Creas tus cuentas** en redes (TikTok, Instagram, YouTube): el usuario exacto que debes usar aparece en la app.
2. **Calientas tus cuentas** durante unos días antes de publicar nada. No es opcional, y hay un módulo entero sobre ello.
3. **Recibes tus misiones** en la app: cada una te dice qué vídeo hacer, con el guion y las indicaciones.
4. **Haces tu vídeo y lo envías** directamente en la misión, una vez publicado en tu cuenta.
5. **Cobras** según tus vistas, que la app sigue automáticamente.

Todo pasa aquí, en esta app. Tus cuentas, tus misiones, tus vistas, tus ganancias: lo sigues todo desde tu espacio. ¿Tienes una pregunta? Pregunta.

Tómate el tiempo de leer todos los módulos antes de empezar. Te ahorrarán los errores que cuestan vistas (o una cuenta).`,
  },
  {
    order: 1,
    title: "Cómo te pagamos",
    contentMarkdown: `En RepackIt cobras por CPM, es decir, según las vistas que generan tus vídeos. Tu acuerdo tiene tres partes:

- **Una base fija**: un importe garantizado por un volumen de vídeos definido.
- **Una parte variable por vistas**: un importe por cada 1.000 vistas de tus vídeos.
- **Niveles de bonus**: recompensas que desbloqueas al alcanzar ciertos totales de vistas acumuladas.

**Las cifras exactas de TU acuerdo** (tu base, tu tarifa por vistas, tus niveles) están en tu contrato. También puedes ver una estimación de tus ganancias directamente en cada misión de la app.

**Cómo se sigue**: cuando tu vídeo está publicado y enviado en la app, recogemos sus vistas automáticamente. Tus ganancias se actualizan a medida que el vídeo suma vistas. No tienes que calcular nada: está todo en tu espacio, en Ganancias.

**Dos condiciones sencillas para cobrar:**

- Tu vídeo tiene que respetar las reglas de contenido (ver el módulo Reglas y requisitos de publicación).
- Tienes que enviar el enlace de tu vídeo en la app después de publicarlo, para que podamos seguir sus vistas.

Añade tus datos de pago en tu perfil en cuanto empieces a ganar; si no, no podremos enviarte lo que se te debe.

${PAYMENT_CURRENCY}`,
  },
  {
    order: 2,
    title: "Crear tus cuentas",
    contentMarkdown: `Antes de producir nada, necesitas cuentas limpias en redes.

**Paso 1: crea cuentas nuevas**

Crea cuentas nuevas en TikTok, Instagram y YouTube (según lo que se te pida). Empieza desde cuentas en blanco, no desde una cuenta personal que ya tengas.

**Paso 2: usa el usuario (@) correcto**

El usuario exacto que debes crear en cada plataforma **aparece en la app** (en tu espacio, en «Crea estas cuentas en tus redes»). Crea exactamente ese usuario en cada plataforma y luego registra la cuenta en la app. Es importante: así seguimos tus vídeos y tus vistas.

**Paso 3: foto de perfil y bio**

- Pon una foto de perfil limpia, coherente con RepackIt.
- Menciona **@repackit.io** en tu bio en todas las cuentas.

**Paso 4: ajustes básicos**

Vincula un email y un número de teléfono a cada cuenta. Así la cuenta parece legítima para las plataformas y baja el riesgo de que limiten tu alcance.

**Paso 5: registra tus cuentas en la app**

Cuando tus cuentas existan, regístralas en tu espacio. Es lo que conecta tus cuentas con tus misiones y permite seguir tus vistas.

¿Cuentas listas y registradas? **Todavía no publiques.** Pasa al módulo de calentamiento.`,
  },
  {
    order: 3,
    slot: "warmup",
    title: "Calentamiento y cómo evitar el shadowban",
    contentMarkdown: `${WARMUP_INTRO}

${WARMUP_TIKTOK}

${WARMUP_INSTAGRAM}

${WARMUP_YOUTUBE}

${WARMUP_RETENTION}

${warmupCheck(`${CHECK_TIKTOK_INSTAGRAM}
- **YouTube, vistas del Short a las 48 h**: de 100 a más de 500.
- **YouTube, fuente «feed de Shorts»**: presente.
- **Las 3 plataformas, prueba con un hashtag único**: tu vídeo se encuentra desde otra cuenta.
- **Las 3 plataformas, tu propio feed se ha centrado en tu nicho**: sí.`)}

${WARMUP_OUTRO}`,
  },
  {
    order: 4,
    title: "Reglas y requisitos de publicación",
    contentMarkdown: `Estas son las reglas que tus vídeos tienen que cumplir para ser validados y pagados. **Si no las cumples, no cobras.**

**Contenido:**

- Cada vídeo tiene que **etiquetar a @repackit.io** en la plataforma correspondiente.
- Tienes que **mencionar @repackit.io en tu bio** en la cuenta desde la que publicas.
- **Duración mínima: 10 segundos** por vídeo.

**Calidad:**

- Tus vídeos tienen que seguir las indicaciones y el guion de cada misión.
- Nada de trampas: las vistas y la interacción nunca deben inflarse artificialmente (los bots están prohibidos y los detectamos).

**Envío:**

- Cuando tu vídeo esté publicado, **envía su enlace en la app** (en la misión correspondiente) para que podamos seguir sus vistas. Hazlo poco después de publicar.

Si cumples esto, todo irá genial. Estamos en esto juntos: tú haces buen contenido y cobras por tus vistas. ¿Alguna pregunta? ¡Estamos disponibles 24/7!`,
  },
];

const SNYTCH_ES: GuideModuleSeed[] = [
  {
    order: 0,
    title: "Bienvenida y cómo funciona",
    contentMarkdown: `**Te damos la bienvenida al equipo de creadores de Snytch 👋**

Snytch es la app de la Gen Z para seguir lo que pasa en una cuenta de Instagram: nuevos seguidores, quién deja de seguirte, quién interactúa más contigo, tanto en cuentas privadas como públicas.

Tu trabajo: hacer vídeos cortos que muestren y expliquen lo que hace Snytch, para que la gente venga a probar la app.

**Así funciona, paso a paso:**

1. **Creas tus cuentas** en redes (TikTok e Instagram): el usuario exacto que debes usar aparece en la app.
2. **Calientas tus cuentas** durante 3 días antes de publicar nada. No es opcional, y hay un módulo entero sobre ello.
3. **Recibes tus misiones** en la app: cada una te dice qué vídeo hacer, con el guion y las indicaciones.
4. **Haces tu vídeo y lo envías** directamente en la misión, una vez publicado en tu cuenta.
5. **Cobras** según tu contrato y tus vistas, que la app sigue automáticamente.

Todo pasa aquí, en esta app. Tus cuentas, tus misiones, tus vistas, tus ganancias: lo sigues todo desde tu espacio. ¿Tienes una pregunta? Escríbele a Anthony por WhatsApp (+33617176306)

Tómate el tiempo de leer todos los módulos antes de empezar. Te ahorrarán los errores que cuestan vistas (o una cuenta).`,
  },
  {
    order: 1,
    title: "Cómo te pagamos",
    contentMarkdown: `En Snytch, lo que cubre tu contrato depende de tu acuerdo: solo vistas, o un importe fijo más una parte por vistas. Estas son las dos partes que dependen de tus vistas:

- **Una parte variable por vistas**: un importe por cada 1.000 vistas de tus vídeos.
- **Niveles de bonus**: recompensas que desbloqueas al alcanzar ciertos totales de vistas acumuladas.

**Las cifras exactas de TU acuerdo** (tu tarifa por vistas, tus niveles) están en tu contrato. También puedes ver una estimación de tus ganancias directamente en cada misión de la app.

**Cómo se sigue**: cuando tu vídeo está publicado y enviado en la app, recogemos sus vistas automáticamente. Tus ganancias se actualizan a medida que el vídeo suma vistas. No tienes que calcular nada: está todo en tu espacio, en Ganancias.

**Dos condiciones sencillas para cobrar:**

- Tu vídeo tiene que respetar las reglas de contenido (ver el módulo Reglas y requisitos de publicación).
- Tienes que enviar el enlace de tu vídeo en la app después de publicarlo, para que podamos seguir sus vistas.

Añade tus datos de pago en tu perfil en cuanto empieces a ganar; si no, no podremos enviarte lo que se te debe.

${PAYMENT_CURRENCY}`,
  },
  {
    order: 2,
    title: "Crear tus cuentas",
    contentMarkdown: `Antes de producir nada, necesitas cuentas limpias en redes.

**Paso 1: crea cuentas nuevas**

Crea cuentas nuevas en TikTok e Instagram (según lo que se te pida). Empieza desde cuentas en blanco, no desde una cuenta personal que ya tengas.

**Paso 2: usa el usuario (@) correcto**

El usuario exacto que debes crear en cada plataforma **aparece en la app** (en tu espacio, en «Crea estas cuentas en tus redes»). Crea exactamente ese usuario en cada plataforma y luego registra la cuenta en la app. Es importante: así seguimos tus vídeos y tus vistas.

**Paso 3: foto de perfil y bio**

- Pon una foto de perfil limpia, que parezca la de una persona normal.
- Menciona el sitio **snytch.co** en tu bio en todas las cuentas.

**Paso 4: ajustes básicos**

Vincula un email y un número de teléfono a cada cuenta. Así la cuenta parece legítima para las plataformas y baja el riesgo de que limiten tu alcance.

**Paso 5: registra tus cuentas en la app**

Cuando tus cuentas existan, regístralas en tu espacio. Es lo que conecta tus cuentas con tus misiones y permite seguir tus vistas.

¿Cuentas listas y registradas? **Todavía no publiques.** Pasa al módulo de calentamiento.`,
  },
  {
    order: 3,
    slot: "warmup",
    title: "Calentamiento y cómo evitar el shadowban",
    contentMarkdown: `${WARMUP_INTRO}

${WARMUP_TIKTOK}

${WARMUP_INSTAGRAM}

${WARMUP_RETENTION}

${warmupCheck(`${CHECK_TIKTOK_INSTAGRAM}
- **Las dos plataformas, prueba con un hashtag único**: tu vídeo se encuentra desde otra cuenta.
- **Las dos plataformas, tu propio feed se ha centrado en tu nicho**: sí.`)}

${WARMUP_OUTRO}`,
  },
  {
    order: 4,
    title: "Condiciones de pago para creadores",
    contentMarkdown: `**Condiciones de pago para creadores**

Para cobrar por su trabajo, todos los creadores partner deben cumplir todos los compromisos fijados en su colaboración.

El pago depende de todo lo siguiente:

* Entregar cada publicación solicitada dentro de los plazos acordados.
* Respetar las indicaciones, los formatos, los requisitos de contenido y las fechas de publicación comunicados para la campaña.
* Obtener la aprobación previa del contenido por parte de los responsables, propietarios o fundadores del sitio antes de publicar nada.
* Completar todas las publicaciones previstas durante todo el mes en cuestión.

La aprobación final del trabajo entregado queda a la entera discreción de los responsables, propietarios y fundadores del sitio.

Puedes consultar el contrato firmado para ver las condiciones exactas de pago.`,
  },
  {
    order: 5,
    title: "Reglas y requisitos de publicación",
    contentMarkdown: `Estas son las reglas que tus vídeos tienen que cumplir para ser validados y pagados. **Si no las cumples, no cobras.**

**Contenido:**

- Cada vídeo **tiene que etiquetar la cuenta de Snytch** en la plataforma correspondiente, allí donde lo indique el guion.
- Tienes que **mencionar Snytch.co en tu bio** en la cuenta desde la que publicas.
- **Duración mínima: 10 segundos** por vídeo.

**Calidad:**

- Tus vídeos tienen que seguir las indicaciones y el guion de cada misión.
- Nada de trampas: las vistas y la interacción nunca deben inflarse artificialmente (los bots están prohibidos, y los detectamos :)).

**Envío:**

- Cuando tu vídeo esté publicado, envía su enlace en la app (en la misión correspondiente) para que podamos seguir sus vistas. Hazlo poco después de publicar.

**Si cumples esto, todo irá genial.** Estamos en esto juntos: tú haces buen contenido y cobras por tus vistas. ¿Alguna pregunta? Pregúntale a Anthony: ¡estamos disponibles 24/7!`,
  },
];

/** Les deux jeux, par slug de projet — la migration n'en connaît pas d'autre. */
export const GUIDE_MODULES_ES: Record<string, GuideModuleSeed[]> = {
  repackit: REPACKIT_ES,
  snytch: SNYTCH_ES,
};
