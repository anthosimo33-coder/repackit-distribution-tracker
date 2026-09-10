/**
 * GROUPAGE DES RAPPELS DE DEADLINE — un e-mail par PERSONNE, pas par mission.
 *
 * POURQUOI. Le rappel était émis PAR MISSION, et une assignation de lot partage
 * UNE échéance de production : les N missions d'un même lot deviennent donc
 * éligibles le même jour, et la créatrice recevait N e-mails identiques à la
 * date près. Relevé en prod le 28/08/2026 : lots de 1 à 11 missions (médiane 2,
 * max 11) — soit jusqu'à onze e-mails le même matin, au même destinataire.
 *
 * L'anti-spam existant (`assignments.deadlineReminderSentAt`) ne pouvait pas
 * l'empêcher : il est PAR MISSION, et il a raison de l'être — c'est lui qui
 * garantit qu'une mission ne relance qu'une fois. Le doublon n'était pas dans le
 * marqueur, il était dans le découpage.
 *
 * Module PUR (aucun import `_generated`) → une seule définition, consommée par
 * l'action serveur ET testée depuis `lib/`. Même patron que `convex/roles.ts`,
 * `convex/soloDays.ts` et `convex/accountPhase.ts` : la règle A6 interdit à
 * `convex/` d'importer `lib/`, pas l'inverse — donc pas de réplique à tenir.
 *
 * Le RENDU du message vit ici aussi, et pas dans l'action : sans ça, « une seule
 * mission ⇒ message strictement inchangé » resterait une affirmation invérifiable.
 * `emailApi` et `emailMessages` sont eux-mêmes purs, l'import ne coûte rien.
 */
import { escapeHtml, p as para } from "./emailApi";
import { emailDate, type ReminderCopy } from "./emailMessages";

/** Une mission éligible au rappel, telle que la rend la query serveur. */
export interface ReminderTarget {
  assignmentId: string;
  email: string;
  name: string;
  /** Langue du destinataire (null ⇒ français). */
  locale: string | null;
  /** null = pas de format nommé. */
  missionLabel: string | null;
  dueDate: number;
}

/**
 * Les missions d'UNE personne, prêtes à tenir dans un seul message.
 *
 * GÉNÉRIQUE sur le type de cible : ce module est pur, il ne peut donc pas
 * connaître `Id<"assignments">` (qui vit dans `_generated`). Sans le paramètre,
 * l'appelant récupérerait des `assignmentId: string` et devrait les recaster —
 * un cast qui, le jour où le champ change, ne dirait rien. Le générique laisse
 * le type CONCRET de l'appelant traverser la fonction intact.
 */
export interface ReminderGroup<T extends ReminderTarget = ReminderTarget> {
  email: string;
  name: string;
  locale: string | null;
  /** Missions de cette personne, la plus ancienne échéance d'abord. */
  items: T[];
  /** Combien sont DÉJÀ en retard (échéance dépassée). Pilote le ton du message. */
  lateCount: number;
}

/**
 * Regroupe par DESTINATAIRE (e-mail), en préservant l'ordre d'arrivée des
 * personnes — la query rend déjà les missions triées par échéance croissante,
 * donc la première personne vue est celle dont l'échéance est la plus proche.
 *
 * ⚠️ La clé est l'E-MAIL, pas le créateur : la même personne peut avoir une
 * fiche par projet (c'est le cas en prod), et deux fiches = deux e-mails dans sa
 * boîte, ce que ce chantier existe précisément pour éviter. Le nom et la langue
 * retenus sont ceux de la PREMIÈRE mission du groupe — deux fiches d'une même
 * personne ne divergent pas là-dessus en pratique, et prendre la première est le
 * seul choix stable (prendre « la plus récente » dépendrait de l'ordre de la
 * table).
 *
 * Comparaison d'e-mail INSENSIBLE À LA CASSE : « Kelly@… » et « kelly@… » sont
 * la même boîte, et les regrouper est tout l'objet de la fonction. La valeur
 * CONSERVÉE reste celle d'origine (on n'écrit jamais une adresse normalisée dans
 * un `To:`).
 */
export function groupRemindersByRecipient<T extends ReminderTarget>(
  targets: readonly T[],
  now: number,
): ReminderGroup<T>[] {
  const byEmail = new Map<string, ReminderGroup<T>>();
  for (const t of targets) {
    const key = t.email.trim().toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.items.push(t);
      if (t.dueDate < now) existing.lateCount++;
    } else {
      byEmail.set(key, {
        email: t.email,
        name: t.name,
        locale: t.locale,
        items: [t],
        lateCount: t.dueDate < now ? 1 : 0,
      });
    }
  }
  for (const g of byEmail.values()) {
    g.items.sort((a, b) => a.dueDate - b.dueDate);
  }
  return [...byEmail.values()];
}

/** Message prêt à poster : sujet, corps HTML, bouton. */
export interface ReminderEmail {
  subject: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  /** true = mise en forme groupée (plusieurs missions dans le message). */
  grouped: boolean;
}

/**
 * Compose le rappel d'UN destinataire.
 *
 * DEUX FORMES, et la première n'a pas bougé :
 *   - UNE mission → exactement le message d'avant ce chantier, lien profond vers
 *     la mission compris. C'est près de la moitié des lots en prod ; le cas
 *     courant ne doit rien perdre au passage ;
 *   - PLUSIEURS → une liste (mission — échéance, marquée « en retard » le cas
 *     échéant) et un CTA vers « Mes missions ». Un lien profond vers l'une des N
 *     serait un choix arbitraire, et cet écran est justement la liste complète.
 */
export function buildReminderEmail<T extends ReminderTarget>(
  group: ReminderGroup<T>,
  now: number,
  copy: ReminderCopy,
  appBaseUrl: string,
): ReminderEmail {
  if (group.items.length === 1) {
    const t = group.items[0];
    const late = t.dueDate < now;
    const dateStrong = `<strong>${escapeHtml(emailDate(t.dueDate, t.locale))}</strong>`;
    const missionStrong =
      t.missionLabel === null
        ? null
        : `<strong>${escapeHtml(t.missionLabel)}</strong>`;
    return {
      subject: copy.subject(late),
      bodyHtml:
        para(copy.greeting(escapeHtml(t.name))) +
        (late
          ? // Tête de phrase → majuscule sur le repli sans format nommé.
            para(
              copy.lateBody(
                missionStrong ?? copy.fallbackMissionLead,
                dateStrong,
              ),
            ) + para(copy.lateClosing)
          : para(
              copy.upcomingBody(
                missionStrong ?? copy.fallbackMissionInline,
                dateStrong,
              ),
            ) + para(copy.upcomingClosing)),
      ctaLabel: copy.ctaLabel,
      ctaUrl: `${appBaseUrl}/app/assignments/${t.assignmentId}`,
      grouped: false,
    };
  }

  const lignes = group.items
    .map((t) => {
      const label = escapeHtml(t.missionLabel ?? copy.fallbackMissionLead);
      const date = escapeHtml(emailDate(t.dueDate, t.locale));
      const retard =
        t.dueDate < now
          ? ` <span style="color:#b91c1c">(${escapeHtml(copy.groupLateTag)})</span>`
          : "";
      return `<li style="margin:0 0 6px"><strong>${label}</strong> — ${date}${retard}</li>`;
    })
    .join("");
  return {
    subject: copy.groupSubject(group.items.length, group.lateCount),
    bodyHtml:
      para(copy.greeting(escapeHtml(group.name))) +
      para(copy.groupIntro(group.items.length, group.lateCount)) +
      `<ul style="margin:0 0 12px;padding-left:20px">${lignes}</ul>` +
      para(copy.groupClosing),
    ctaLabel: copy.groupCtaLabel,
    ctaUrl: `${appBaseUrl}/app/missions`,
    grouped: true,
  };
}
