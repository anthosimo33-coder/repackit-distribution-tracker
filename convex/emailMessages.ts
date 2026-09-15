import { localeOrDefault, type Locale } from "./locales";

/**
 * CATALOGUE DES E-MAILS — côté serveur, et il ne peut pas en être autrement.
 *
 * next-intl ne sert PAS les e-mails : ils partent du runtime Convex, qui
 * n'importe rien hors de `convex/` (règle A6) et n'a ni requête HTTP, ni cookie,
 * ni `Accept-Language`. La chaîne de résolution habituelle n'a donc aucun de ses
 * maillons ici — la langue arrive en argument, depuis la fiche du DESTINATAIRE,
 * et le défaut doit être explicite (`localeOrDefault`).
 *
 * Les e-mails sont traduits dans les QUATRE langues livrées (fr, en, es, pt) :
 * INVITE, APPROVED, REJECTED, PAID, REVERTED, ASSIGNED, NUDGE, REMINDER. Le type
 * `Record<Locale, …>` refuse de compiler une langue oubliée.
 *
 * L'invitation compte double : c'est le premier contact d'un créateur étranger,
 * reçu AVANT sa première connexion — donc avant tout écran, avant tout
 * `NEXT_LOCALE`. En français, le parcours est perdu au premier geste.
 *
 * Les valeurs anglaises, espagnoles et portugaises sont de VRAIES traductions :
 * ces e-mails doivent être lisibles par quelqu'un qui ne parle pas français.
 *
 * ⚠️ RIEN NE SURVEILLE CE FICHIER. Il est hors de la clôture d'imports (le
 * runtime Convex n'est jamais importé côté client, règle A6), donc hors du
 * périmètre généré : le type impose une branche par langue, mais y recopier du
 * français ne casse AUCUN test et n'allume AUCUNE garde. Toute PR qui touche
 * ce fichier se relit langue par langue, à la main.
 * Voir `I18N_STATUS.md` §11.7 — dette identifiée : étendre les règles de
 * catalogue (parité des clés, `en` ≠ `fr`) à ces `Record<Locale, …>`.
 */

export interface InviteEmailCopy {
  subject: string;
  greeting: (name: string) => string;
  intro: string;
  linkHint: string;
  ctaLabel: string;
  footerNote: string;
}

const INVITE: Record<Locale, InviteEmailCopy> = {
  fr: {
    subject: "Bienvenue chez Jarvia 👋",
    greeting: (name) => `Salut ${name},`,
    intro:
      "Ton espace créateur est prêt. Tu y retrouveras tes missions, tes vidéos " +
      "et tes gains, tout au même endroit.",
    linkHint:
      "Le lien ci-dessous te permet de choisir ton mot de passe et de commencer.",
    ctaLabel: "Activer mon accès",
    footerNote:
      "Le lien est personnel et à usage unique. S'il a expiré, écris-moi et je t'en renvoie un.",
  },
  en: {
    subject: "Welcome to Jarvia 👋",
    greeting: (name) => `Hi ${name},`,
    intro:
      "Your creator space is ready. You'll find your assignments, your videos " +
      "and your earnings all in one place.",
    linkHint:
      "Use the link below to choose your password and get started.",
    ctaLabel: "Activate my access",
    footerNote:
      "This link is personal and can only be used once. If it has expired, just write to me and I'll send you a new one.",
  },
  es: {
    subject: "Te damos la bienvenida a Jarvia 👋",
    greeting: (name) => `Hola ${name}:`,
    intro:
      "Tu espacio de creador está listo. Ahí encontrarás tus misiones, tus vídeos " +
      "y tus ganancias, todo en un mismo lugar.",
    linkHint:
      "Con el enlace de abajo puedes elegir tu contraseña y empezar.",
    ctaLabel: "Activar mi acceso",
    footerNote:
      "El enlace es personal y de un solo uso. Si ha caducado, escríbeme y te envío uno nuevo.",
  },
  pt: {
    subject: "Boas-vindas à Jarvia 👋",
    greeting: (name) => `Oi ${name},`,
    intro:
      "Seu espaço de criador está pronto. Lá você encontra suas missões, seus vídeos " +
      "e seus ganhos, tudo no mesmo lugar.",
    linkHint:
      "Pelo link abaixo você escolhe sua senha e já pode começar.",
    ctaLabel: "Ativar meu acesso",
    footerNote:
      "O link é pessoal e só pode ser usado uma vez. Se ele expirou, me escreva que eu envio outro.",
  },
};

export function inviteEmailCopy(locale: unknown): InviteEmailCopy {
  return INVITE[localeOrDefault(locale)];
}

// ─── Mise en forme, côté serveur ─────────────────────────────────────────────

/**
 * Date COURTE et déterministe, sans `Intl` : le runtime Convex n'a ni fuseau de
 * requête ni garantie d'ICU complet, et ces dates partent dans des e-mails qui
 * doivent être identiques d'un run à l'autre. UTC délibéré (cf convex/dateFr.ts,
 * dont c'est aussi la règle pour les e-mails).
 *
 * ⚠️ L'ORDRE DES CHAMPS CHANGE avec la langue, et c'est tout l'enjeu :
 * « 03/09/2026 » se lit 3 septembre en français et 9 mars en anglais US. Les
 * deux sont plausibles, aucune erreur n'est visible — une créatrice US pouvait
 * rendre sa vidéo six mois trop tard sans que personne ne comprenne pourquoi.
 */
export function emailDate(ms: number, locale: unknown): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  // Seul l'anglais US met le mois en tête ; es et pt s'écrivent comme le français.
  return localeOrDefault(locale) === "en"
    ? `${mm}/${dd}/${yyyy}`
    : `${dd}/${mm}/${yyyy}`;
}

/**
 * Montant. Le SYMBOLE reste le dollar : c'est la devise de la paie créatrices
 * (`projects.payCurrency`), elle vient de la transaction et ne dérive jamais de
 * la langue. Seule la mise en forme suit : « 1 234,56 $ » contre « $1,234.56 ».
 */
export function emailAmount(n: number, locale: unknown): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, dec] = rounded.toFixed(2).split(".");
  const l = localeOrDefault(locale);
  if (l === "en") {
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return dec === "00" ? `$${grouped}` : `$${grouped}.${dec}`;
  }
  if (l === "es" || l === "pt") {
    // « US$ » : en espagnol comme en portugais du Brésil, « $ » seul se lit
    // aussi comme la devise locale (peso, real). Groupement par point.
    const dotted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const n = dec === "00" ? dotted : `${dotted},${dec}`;
    return l === "pt" ? `US$ ${n}` : `${n} US$`;
  }
  const spaced = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec === "00" ? `${spaced} $` : `${spaced},${dec} $`;
}

// ─── Les six autres e-mails ──────────────────────────────────────────────────
//
// Chaque copie reçoit des fragments DÉJÀ ÉCHAPPÉS (nom, libellé de mission) et
// rend du HTML : c'est la convention de convex/emails.ts, conservée telle quelle.

export interface ApprovedCopy {
  subject: string;
  greeting: (name: string) => string;
  body: (missionStrong: string | null) => string;
  ctaLabel: string;
}

const APPROVED: Record<Locale, ApprovedCopy> = {
  fr: {
    subject: "Ta vidéo est validée ✅",
    greeting: (name) => `Salut ${name},`,
    body: (m) =>
      `${m === null ? "C'est bon, ta vidéo est validée." : `C'est bon pour ${m}, ta vidéo est validée.`} Tu peux passer à la publication depuis ton espace.`,
    ctaLabel: "Voir la mission",
  },
  en: {
    subject: "Your video is approved ✅",
    greeting: (name) => `Hi ${name},`,
    body: (m) =>
      `${m === null ? "All good, your video is approved." : `All good on ${m}, your video is approved.`} You can go ahead and publish it from your space.`,
    ctaLabel: "View the assignment",
  },
  es: {
    subject: "Tu vídeo está aprobado ✅",
    greeting: (name) => `Hola ${name}:`,
    body: (m) =>
      `${m === null ? "Todo bien, tu vídeo está aprobado." : `Todo bien con ${m}, tu vídeo está aprobado.`} Ya puedes publicarlo desde tu espacio.`,
    ctaLabel: "Ver la misión",
  },
  pt: {
    subject: "Seu vídeo foi aprovado ✅",
    greeting: (name) => `Oi ${name},`,
    body: (m) =>
      `${m === null ? "Tudo certo, seu vídeo foi aprovado." : `Tudo certo com ${m}, seu vídeo foi aprovado.`} Você já pode publicá-lo pelo seu espaço.`,
    ctaLabel: "Ver a missão",
  },
};

export interface RejectedCopy {
  subject: string;
  greeting: (name: string) => string;
  intro: (missionStrong: string | null) => string;
  closing: string;
  ctaLabel: string;
}

const REJECTED: Record<Locale, RejectedCopy> = {
  fr: {
    // Aucun emoji sur cet e-mail (consigne explicite, conservée en anglais).
    subject: "Petite correction sur ta vidéo",
    greeting: (name) => `Salut ${name},`,
    intro: (m) =>
      `${m === null ? "J'ai regardé ta dernière vidéo" : `J'ai regardé ta vidéo pour ${m}`}, il y a un ou deux trucs à ajuster avant de la publier :`,
    closing:
      "Rien de grave, tu corriges et tu re-soumets directement depuis ta mission.",
    ctaLabel: "Corriger ma vidéo",
  },
  en: {
    subject: "A small fix on your video",
    greeting: (name) => `Hi ${name},`,
    intro: (m) =>
      `${m === null ? "I watched your latest video" : `I watched your video for ${m}`} — there are one or two things to adjust before you publish it:`,
    closing:
      "Nothing serious. Fix it and resubmit straight from your assignment.",
    ctaLabel: "Fix my video",
  },
  es: {
    subject: "Un pequeño ajuste en tu vídeo",
    greeting: (name) => `Hola ${name}:`,
    intro: (m) =>
      `${m === null ? "He visto tu último vídeo" : `He visto tu vídeo para ${m}`} y hay una o dos cosas que ajustar antes de publicarlo:`,
    closing:
      "Nada grave: lo corriges y lo vuelves a enviar directamente desde tu misión.",
    ctaLabel: "Corregir mi vídeo",
  },
  pt: {
    subject: "Um pequeno ajuste no seu vídeo",
    greeting: (name) => `Oi ${name},`,
    intro: (m) =>
      `${m === null ? "Assisti ao seu último vídeo" : `Assisti ao seu vídeo para ${m}`} e tem uma ou duas coisas para ajustar antes de publicar:`,
    closing:
      "Nada grave: é só corrigir e reenviar direto pela sua missão.",
    ctaLabel: "Corrigir meu vídeo",
  },
};

export interface PaidCopy {
  subject: (money: string) => string;
  greeting: (name: string) => string;
  period: (from: string, to: string) => string;
  body: (periodStrong: string, moneyStrong: string) => string;
  detail: string;
  ctaLabel: string;
}

const PAID: Record<Locale, PaidCopy> = {
  fr: {
    subject: (money) => `${money} en route 💸`,
    greeting: (name) => `Salut ${name},`,
    // « du X au Y » plutôt qu'un tiret (aucun tiret cadratin dans les contenus).
    period: (from, to) => `${from} au ${to}`,
    body: (p, m) => `Ton cycle du ${p} est payé : ${m}.`,
    detail: "Le détail vidéo par vidéo est dans ton espace.",
    ctaLabel: "Voir mes paiements",
  },
  en: {
    subject: (money) => `${money} on its way 💸`,
    greeting: (name) => `Hi ${name},`,
    period: (from, to) => `${from} to ${to}`,
    body: (p, m) => `Your cycle from ${p} is paid: ${m}.`,
    detail: "The video-by-video breakdown is in your space.",
    ctaLabel: "View my payments",
  },
  es: {
    subject: (money) => `${money} en camino 💸`,
    greeting: (name) => `Hola ${name}:`,
    period: (from, to) => `${from} al ${to}`,
    body: (p, m) => `Tu ciclo del ${p} está pagado: ${m}.`,
    detail: "El detalle vídeo por vídeo está en tu espacio.",
    ctaLabel: "Ver mis pagos",
  },
  pt: {
    subject: (money) => `${money} a caminho 💸`,
    greeting: (name) => `Oi ${name},`,
    period: (from, to) => `${from} a ${to}`,
    body: (p, m) => `Seu ciclo de ${p} foi pago: ${m}.`,
    detail: "O detalhe vídeo por vídeo está no seu espaço.",
    ctaLabel: "Ver meus pagamentos",
  },
};

/**
 * ANNULATION d'un paiement posé par erreur. L'e-mail existe parce que celui du
 * paiement, lui, est DÉJÀ parti : laisser une créatrice sur « tu as été payée »
 * pendant qu'on lui redevient débiteur, c'est le pire des deux mondes. Ton
 * volontairement sobre et non alarmant — une erreur de saisie n'est pas un
 * litige, et le montant réapparaît dans son espace.
 */
export interface RevertedCopy {
  subject: string;
  greeting: (name: string) => string;
  period: (from: string, to: string) => string;
  body: (periodStrong: string, moneyStrong: string) => string;
  detail: string;
  ctaLabel: string;
}

const REVERTED: Record<Locale, RevertedCopy> = {
  fr: {
    subject: "Correction sur ton dernier paiement",
    greeting: (name) => `Salut ${name},`,
    period: (from, to) => `${from} au ${to}`,
    body: (p, m) =>
      `Petite erreur de ma part : j'avais marqué ton cycle du ${p} comme payé (${m}), alors qu'il ne l'était pas encore. Le montant redevient dû, rien n'est perdu.`,
    detail: "Il réapparaît dans ton espace, et je te le verse au prochain virement.",
    ctaLabel: "Voir mes paiements",
  },
  en: {
    subject: "A correction on your last payment",
    greeting: (name) => `Hi ${name},`,
    period: (from, to) => `${from} to ${to}`,
    body: (p, m) =>
      `My mistake: I marked your cycle from ${p} as paid (${m}) when it hadn't been paid yet. The amount is due again — nothing is lost.`,
    detail: "It's back in your space, and I'll send it with the next payout.",
    ctaLabel: "View my payments",
  },
  es: {
    subject: "Corrección en tu último pago",
    greeting: (name) => `Hola ${name}:`,
    period: (from, to) => `${from} al ${to}`,
    body: (p, m) =>
      `Un pequeño error por mi parte: marqué tu ciclo del ${p} como pagado (${m}) cuando todavía no lo estaba. El importe vuelve a estar pendiente, no se pierde nada.`,
    detail: "Vuelve a aparecer en tu espacio y te lo envío en la próxima transferencia.",
    ctaLabel: "Ver mis pagos",
  },
  pt: {
    subject: "Correção no seu último pagamento",
    greeting: (name) => `Oi ${name},`,
    period: (from, to) => `${from} a ${to}`,
    body: (p, m) =>
      `Um pequeno erro meu: marquei seu ciclo de ${p} como pago (${m}) quando ele ainda não tinha sido pago. O valor volta a ficar pendente, nada foi perdido.`,
    detail: "Ele aparece de novo no seu espaço, e eu envio no próximo pagamento.",
    ctaLabel: "Ver meus pagamentos",
  },
};

export interface AssignedCopy {
  subject: (count: number) => string;
  greeting: (name: string) => string;
  body: (count: number, missionStrong: string | null) => string;
  schedule: (dateStrong: string) => string;
  ctaLabel: (count: number) => string;
}

const ASSIGNED: Record<Locale, AssignedCopy> = {
  fr: {
    subject: (n) =>
      n > 1 ? `${n} nouvelles vidéos pour toi 🎬` : "Nouvelle mission pour toi 🎬",
    greeting: (name) => `Salut ${name},`,
    body: (n, m) =>
      `Tu as ${n > 1 ? `${n} nouvelles vidéos à produire` : "une nouvelle vidéo à produire"}${m === null ? "" : ` sur ${m}`}.`,
    schedule: (d) =>
      `Le script, les consignes et l'échéance (${d}) sont dans ton espace.`,
    ctaLabel: (n) => (n > 1 ? "Voir mes missions" : "Voir ma mission"),
  },
  en: {
    subject: (n) =>
      n > 1 ? `${n} new videos for you 🎬` : "New assignment for you 🎬",
    greeting: (name) => `Hi ${name},`,
    body: (n, m) =>
      `You have ${n > 1 ? `${n} new videos to shoot` : "a new video to shoot"}${m === null ? "" : ` on ${m}`}.`,
    schedule: (d) =>
      `The script, the brief and the due date (${d}) are in your space.`,
    ctaLabel: (n) => (n > 1 ? "View my assignments" : "View my assignment"),
  },
  es: {
    subject: (n) =>
      n > 1 ? `${n} vídeos nuevos para ti 🎬` : "Nueva misión para ti 🎬",
    greeting: (name) => `Hola ${name}:`,
    body: (n, m) =>
      `Tienes ${n > 1 ? `${n} vídeos nuevos por grabar` : "un vídeo nuevo por grabar"}${m === null ? "" : ` para ${m}`}.`,
    schedule: (d) =>
      `El guion, las indicaciones y la fecha límite (${d}) están en tu espacio.`,
    ctaLabel: (n) => (n > 1 ? "Ver mis misiones" : "Ver mi misión"),
  },
  pt: {
    subject: (n) =>
      n > 1 ? `${n} vídeos novos para você 🎬` : "Nova missão para você 🎬",
    greeting: (name) => `Oi ${name},`,
    body: (n, m) =>
      `Você tem ${n > 1 ? `${n} vídeos novos para gravar` : "um vídeo novo para gravar"}${m === null ? "" : ` para ${m}`}.`,
    schedule: (d) =>
      `O roteiro, as orientações e o prazo (${d}) estão no seu espaço.`,
    ctaLabel: (n) => (n > 1 ? "Ver minhas missões" : "Ver minha missão"),
  },
};

export interface NudgeCopy {
  subject: (rejected: boolean) => string;
  greeting: (name: string) => string;
  rejectedBody: (missionStrong: string) => string;
  rejectedClosing: string;
  pendingBody: (missionStrong: string, dateStrong: string) => string;
  pendingClosing: string;
  fallbackMission: string;
  ctaLabel: (rejected: boolean) => string;
}

const NUDGE: Record<Locale, NudgeCopy> = {
  fr: {
    subject: (r) => (r ? "Tu as un retour à traiter" : "Où en es-tu ? 🙂"),
    greeting: (name) => `Salut ${name},`,
    rejectedBody: (m) =>
      `J'ai laissé un retour sur ta vidéo pour ${m}, tu peux la corriger et la re-soumettre quand tu veux.`,
    rejectedClosing: "Si quelque chose n'est pas clair, réponds-moi, on en parle.",
    pendingBody: (m, d) => `Je fais un point sur ${m}, attendue pour le ${d}.`,
    pendingClosing:
      "Si tu as besoin de quoi que ce soit pour avancer ou de plus de temps, réponds-moi, on trouvera une solution.",
    fallbackMission: "ta mission",
    ctaLabel: (r) => (r ? "Corriger ma vidéo" : "Ouvrir ma mission"),
  },
  en: {
    subject: (r) => (r ? "You have feedback to handle" : "How's it going? 🙂"),
    greeting: (name) => `Hi ${name},`,
    rejectedBody: (m) =>
      `I left feedback on your video for ${m} — you can fix it and resubmit whenever you're ready.`,
    rejectedClosing: "If anything is unclear, just reply and we'll talk it through.",
    pendingBody: (m, d) => `Checking in on ${m}, due on ${d}.`,
    pendingClosing:
      "If you need anything to move forward, or more time, reply to me and we'll sort it out.",
    fallbackMission: "your assignment",
    ctaLabel: (r) => (r ? "Fix my video" : "Open my assignment"),
  },
  es: {
    subject: (r) => (r ? "Tienes un comentario pendiente" : "¿Cómo vas? 🙂"),
    greeting: (name) => `Hola ${name}:`,
    rejectedBody: (m) =>
      `Te dejé un comentario sobre tu vídeo para ${m}: puedes corregirlo y volver a enviarlo cuando quieras.`,
    rejectedClosing: "Si algo no está claro, respóndeme y lo hablamos.",
    pendingBody: (m, d) => `Te escribo para ver cómo va ${m}, prevista para el ${d}.`,
    pendingClosing:
      "Si necesitas cualquier cosa para avanzar o más tiempo, respóndeme y encontraremos una solución.",
    fallbackMission: "tu misión",
    ctaLabel: (r) => (r ? "Corregir mi vídeo" : "Abrir mi misión"),
  },
  pt: {
    subject: (r) => (r ? "Você tem um retorno para ver" : "Como estão as coisas? 🙂"),
    greeting: (name) => `Oi ${name},`,
    rejectedBody: (m) =>
      `Deixei um retorno sobre seu vídeo para ${m}: você pode corrigir e reenviar quando quiser.`,
    rejectedClosing: "Se algo não ficou claro, me responda e a gente conversa.",
    pendingBody: (m, d) => `Passando para saber como está ${m}, com prazo em ${d}.`,
    pendingClosing:
      "Se precisar de qualquer coisa para avançar ou de mais tempo, me responda que a gente encontra uma solução.",
    fallbackMission: "sua missão",
    ctaLabel: (r) => (r ? "Corrigir meu vídeo" : "Abrir minha missão"),
  },
};

export interface ReminderCopy {
  subject: (late: boolean) => string;
  greeting: (name: string) => string;
  lateBody: (missionStrong: string, dateStrong: string) => string;
  lateClosing: string;
  upcomingBody: (missionStrong: string, dateStrong: string) => string;
  upcomingClosing: string;
  /** Repli EN TÊTE DE PHRASE : majuscule (« Ta mission était attendue… »). */
  fallbackMissionLead: string;
  /** Repli EN MILIEU DE PHRASE : minuscule (« rappel : ta mission est… »). */
  fallbackMissionInline: string;
  ctaLabel: string;

  // ─── Variante GROUPÉE : plusieurs missions dans UN message ─────────────────
  // Un lot d'assignation partage une échéance, donc ses N missions deviennent
  // éligibles le même jour. Sans ces libellés, c'était N e-mails identiques.
  // La formulation change selon qu'il y a du retard ou non : « on attend » et
  // « petit rappel » ne se disent pas dans le même ton.
  /** Objet du message groupé. `lateCount` > 0 ⇒ ton de relance. */
  groupSubject: (count: number, lateCount: number) => string;
  /** Phrase d'introduction, avant la liste des missions. */
  groupIntro: (count: number, lateCount: number) => string;
  /** Marqueur accolé à une ligne dont l'échéance est dépassée. */
  groupLateTag: string;
  groupClosing: string;
  groupCtaLabel: string;
}

const REMINDER: Record<Locale, ReminderCopy> = {
  fr: {
    subject: (late) =>
      late ? "On attend ta vidéo 👀" : "Ta mission arrive à échéance",
    greeting: (name) => `Salut ${name},`,
    lateBody: (m, d) =>
      `${m} était attendue pour le ${d} et on ne l'a pas encore reçue.`,
    lateClosing:
      "Si tu as un souci ou besoin de plus de temps, réponds-moi directement, on trouvera une solution.",
    upcomingBody: (m, d) => `Petit rappel : ${m} est attendue pour le ${d}.`,
    upcomingClosing: "Tu peux déposer ta vidéo directement depuis ton espace.",
    fallbackMissionLead: "Ta mission",
    fallbackMissionInline: "ta mission",
    ctaLabel: "Ouvrir ma mission",
    groupSubject: (n, late) =>
      late > 0
        ? `On attend ${late > 1 ? `${late} vidéos` : "une vidéo"} 👀`
        : `${n} missions arrivent à échéance`,
    groupIntro: (n, late) =>
      late > 0
        ? `Tu as <strong>${n} missions</strong> en cours, dont <strong>${late}</strong> dont l'échéance est déjà passée :`
        : `Petit rappel : <strong>${n} missions</strong> arrivent à échéance.`,
    groupLateTag: "en retard",
    groupClosing:
      "Tu peux déposer tes vidéos directement depuis ton espace. Si tu as un souci ou besoin de plus de temps, réponds-moi.",
    groupCtaLabel: "Voir mes missions",
  },
  en: {
    subject: (late) =>
      late ? "We're waiting on your video 👀" : "Your assignment is due soon",
    greeting: (name) => `Hi ${name},`,
    lateBody: (m, d) => `${m} was due on ${d} and we haven't received it yet.`,
    lateClosing:
      "If something is in the way or you need more time, just reply to me and we'll sort it out.",
    upcomingBody: (m, d) => `Quick reminder: ${m} is due on ${d}.`,
    upcomingClosing: "You can upload your video straight from your space.",
    fallbackMissionLead: "Your assignment",
    fallbackMissionInline: "your assignment",
    ctaLabel: "Open my assignment",
    groupSubject: (n, late) =>
      late > 0
        ? `We're waiting on ${late > 1 ? `${late} videos` : "a video"} 👀`
        : `${n} assignments are due soon`,
    groupIntro: (n, late) =>
      late > 0
        ? `You have <strong>${n} assignments</strong> open, <strong>${late}</strong> of them already past due:`
        : `Quick reminder: <strong>${n} assignments</strong> are coming due.`,
    groupLateTag: "past due",
    groupClosing:
      "You can upload your videos straight from your space. If something is in the way or you need more time, just reply to me.",
    groupCtaLabel: "See my assignments",
  },
  es: {
    subject: (late) =>
      late ? "Estamos esperando tu vídeo 👀" : "Tu misión está por vencer",
    greeting: (name) => `Hola ${name}:`,
    lateBody: (m, d) =>
      `${m} estaba prevista para el ${d} y todavía no la hemos recibido.`,
    lateClosing:
      "Si tienes algún problema o necesitas más tiempo, respóndeme directamente y encontraremos una solución.",
    upcomingBody: (m, d) => `Un pequeño recordatorio: ${m} está prevista para el ${d}.`,
    upcomingClosing: "Puedes subir tu vídeo directamente desde tu espacio.",
    fallbackMissionLead: "Tu misión",
    fallbackMissionInline: "tu misión",
    ctaLabel: "Abrir mi misión",
    groupSubject: (n, late) =>
      late > 0
        ? `Estamos esperando ${late > 1 ? `${late} vídeos` : "un vídeo"} 👀`
        : `${n} misiones están por vencer`,
    groupIntro: (n, late) =>
      late > 0
        ? `Tienes <strong>${n} misiones</strong> en curso, y <strong>${late}</strong> ya han pasado su fecha límite:`
        : `Un pequeño recordatorio: <strong>${n} misiones</strong> están por vencer.`,
    groupLateTag: "con retraso",
    groupClosing:
      "Puedes subir tus vídeos directamente desde tu espacio. Si tienes algún problema o necesitas más tiempo, respóndeme.",
    groupCtaLabel: "Ver mis misiones",
  },
  pt: {
    subject: (late) =>
      late ? "Estamos esperando seu vídeo 👀" : "Sua missão está perto do prazo",
    greeting: (name) => `Oi ${name},`,
    lateBody: (m, d) =>
      `${m} tinha prazo em ${d} e ainda não recebemos.`,
    lateClosing:
      "Se tiver algum problema ou precisar de mais tempo, me responda direto que a gente encontra uma solução.",
    upcomingBody: (m, d) => `Só um lembrete: ${m} tem prazo em ${d}.`,
    upcomingClosing: "Você pode enviar seu vídeo direto pelo seu espaço.",
    fallbackMissionLead: "Sua missão",
    fallbackMissionInline: "sua missão",
    ctaLabel: "Abrir minha missão",
    groupSubject: (n, late) =>
      late > 0
        ? `Estamos esperando ${late > 1 ? `${late} vídeos` : "um vídeo"} 👀`
        : `${n} missões estão perto do prazo`,
    groupIntro: (n, late) =>
      late > 0
        ? `Você tem <strong>${n} missões</strong> em andamento, e <strong>${late}</strong> já passaram do prazo:`
        : `Só um lembrete: <strong>${n} missões</strong> estão perto do prazo.`,
    groupLateTag: "atrasada",
    groupClosing:
      "Você pode enviar seus vídeos direto pelo seu espaço. Se tiver algum problema ou precisar de mais tempo, me responda.",
    groupCtaLabel: "Ver minhas missões",
  },
};

export const approvedEmailCopy = (l: unknown): ApprovedCopy =>
  APPROVED[localeOrDefault(l)];
export const rejectedEmailCopy = (l: unknown): RejectedCopy =>
  REJECTED[localeOrDefault(l)];
export const paidEmailCopy = (l: unknown): PaidCopy => PAID[localeOrDefault(l)];
export const revertedEmailCopy = (l: unknown): RevertedCopy =>
  REVERTED[localeOrDefault(l)];
export const assignedEmailCopy = (l: unknown): AssignedCopy =>
  ASSIGNED[localeOrDefault(l)];
export const nudgeEmailCopy = (l: unknown): NudgeCopy => NUDGE[localeOrDefault(l)];
export const reminderEmailCopy = (l: unknown): ReminderCopy =>
  REMINDER[localeOrDefault(l)];
