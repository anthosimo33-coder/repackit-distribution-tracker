import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * CÂBLAGE des notifications hors-app — vérifié sur le SOURCE.
 *
 * Ces propriétés ne sont pas observables en e2e : sans jeton Telegram le canal
 * est éteint par construction, donc aucun envoi n'a lieu. Ce qu'on peut
 * verrouiller, c'est l'endroit où l'accroche est posée — et c'est précisément là
 * que se joue le risque.
 */
const SRC = readFileSync(join(process.cwd(), "convex", "assignments.ts"), "utf8");

/**
 * Corps de `confirmPublicationCore`, borné à SA propre accolade fermante.
 *
 * La borne était « jusqu'au premier wrapper qui suit » — ce qui marchait tant
 * que rien ne s'intercalait. La PR 6 a inséré une fonction de bornes ET la
 * mutation clippeur entre les deux, et le `throw` de la première s'est retrouvé
 * compté comme appartenant au cœur : le test a rougi sur du code parfaitement
 * correct. Une borne de source doit délimiter la FONCTION, pas la distance
 * jusqu'au voisin — sinon elle mesure la mise en page du fichier.
 */
function coeurPublication(): string {
  const debut = SRC.indexOf("async function confirmPublicationCore(");
  expect(debut).toBeGreaterThan(-1);
  // Accolade fermante en COLONNE 0 : à l'intérieur de la fonction, toutes les
  // accolades sont indentées.
  const fin = SRC.indexOf("\n}\n", debut);
  expect(fin).toBeGreaterThan(debut);
  const coeur = SRC.slice(debut, fin);
  // Garde-fou de la borne elle-même : si elle se refermait trop tôt, les
  // assertions d'ordre ci-dessous deviendraient vertes pour rien.
  expect(coeur).toContain("return { ok: true, alreadyPublished: false");
  return coeur;
}

describe("publication — l'accroche vit dans le cœur PARTAGÉ", () => {
  it("notifyPublication est planifié dans confirmPublicationCore", () => {
    // Le cœur est traversé par la créatrice (confirmPublication) ET par l'admin
    // en secours (confirmPublicationAsAdmin). C'est la seule position qui
    // garantit qu'un lien collé par l'admin notifie comme celui de la créatrice.
    expect(coeurPublication()).toContain(
      "internal.notifications.notifyPublication",
    );
  });

  it("aucun wrapper ne la duplique (sinon : deux messages, ou un seul chemin couvert)", () => {
    const apresCoeur = SRC.slice(
      SRC.indexOf("export const confirmPublication = creatorMutation"),
    );
    const occurrences = apresCoeur.split("internal.notifications.notifyPublication").length - 1;
    expect(occurrences).toBe(0);
  });

  it("elle est planifiée, jamais appelée dans la transaction", () => {
    // Une mutation Convex est atomique : un appel externe non protégé dedans
    // transformerait un échec de notification en échec de publication.
    expect(coeurPublication()).toMatch(
      /scheduler\.runAfter\(\s*0,\s*internal\.notifications\.notifyPublication/,
    );
  });
});

/**
 * ORDRE dans le cœur de publication.
 *
 * `confirmPublicationCore` est le point de CONTENTION du repo : trois chantiers
 * y ont posé quelque chose en quelques jours (garde de quota clippeur,
 * notification, et bientôt la saisie de date réelle côté clippeur). Le conflit
 * de merge se verrait ; le conflit SÉMANTIQUE, non. D'où ces bornes.
 *
 * La propriété qui compte : rien ne doit pouvoir REFUSER la publication après
 * que la notification a été planifiée. Un message « publication confirmée » sur
 * une publication refusée serait pire que pas de message du tout.
 */
describe("publication — la notification est la DERNIÈRE chose du cœur", () => {
  const coeur = coeurPublication();
  const pos = (needle: string) => {
    const i = coeur.indexOf(needle);
    expect(i, `introuvable dans le cœur : ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it("planifiée APRÈS le retour idempotent (re-confirmer n'envoie rien)", () => {
    expect(pos("internal.notifications.notifyPublication")).toBeGreaterThan(
      pos("alreadyPublished: true"),
    );
  });

  it("planifiée APRÈS la garde de quota clippeur (un refus ne notifie pas)", () => {
    // La garde jette (quotaRefusalMessage) : placée avant, la ligne de
    // planification n'est jamais atteinte sur un refus.
    expect(pos("internal.notifications.notifyPublication")).toBeGreaterThan(
      pos("assertClipperDailyQuota"),
    );
  });

  it("planifiée APRÈS le passage effectif en published", () => {
    expect(pos("internal.notifications.notifyPublication")).toBeGreaterThan(
      pos('status: "published"'),
    );
  });

  it("planifiée APRÈS le patch de publishedBy, que le message LIT", () => {
    // Le message distingue « la créatrice a publié » de « l'admin a rattrapé »
    // en relisant publishedBy. Si un chantier déplaçait ce patch après la
    // notification, l'admin en secours serait annoncé comme une créatrice —
    // exactement l'inverse de ce que la mention doit éviter.
    expect(pos("internal.notifications.notifyPublication")).toBeGreaterThan(
      pos("publishedBy: opts.confirmedBy"),
    );
  });

  it("les publishedUrl sont PERSISTÉES avant la planification", () => {
    // L'action RELIT l'assignation pour composer le message (comme celle de
    // soumission — deux mécanismes différents pour deux notifications voisines
    // seraient la prochaine confusion). Ce choix a une condition : les URL
    // doivent être en base quand l'action s'exécute. Si un chantier déplaçait
    // le patch des targets après la planification, le message dirait « aucune
    // cible » EN SILENCE. Cette borne le dit au moment où le chantier s'écrit.
    expect(pos("internal.notifications.notifyPublication")).toBeGreaterThan(
      pos("targets: newTargets"),
    );
    expect(pos("targets: newTargets")).toBeGreaterThan(pos("publishedUrl: url"));
  });

  it("AUCUN throw ne subsiste après la planification", () => {
    // La borne générique, celle qui tiendra face au prochain chantier : quoi
    // qu'on ajoute au cœur, ça doit se placer AVANT la notification si ça peut
    // encore refuser la publication.
    const apres = coeur.slice(
      coeur.indexOf("internal.notifications.notifyPublication"),
    );
    expect(apres).not.toContain("throw ");
  });

  it("PLUS RIEN n'est planifié après les notifications", () => {
    // La propriété visée n'est pas « notifyPublication est la dernière ligne » —
    // c'était vrai quand il n'y avait qu'une notification, et la version qui
    // l'écrivait comme ça a rougi le jour où une SECONDE est arrivée (« retard »),
    // sur du code parfaitement correct. Ce qui compte : après la première
    // notification, il ne reste QUE des notifications. Une purge, un accrual ou
    // un patch planifié là serait, lui, un vrai défaut — la notification
    // affirmerait un état que la suite peut encore modifier.
    //
    // Comparer des index bruts serait tautologique (la ligne de notification
    // contient elle-même « scheduler.runAfter( ») : on regarde CE QUE plante
    // chaque appel.
    const appels = [...coeur.matchAll(/scheduler\.runAfter\(/g)].map(
      (m) => m.index ?? 0,
    );
    expect(appels.length).toBeGreaterThan(1); // le cœur en a d'autres (purge Stream)
    const premiereNotif = coeur.indexOf("internal.notifications.notify");
    expect(premiereNotif).toBeGreaterThan(-1);
    const apres = appels.filter((i) => i > premiereNotif);
    expect(apres.length).toBeGreaterThan(0); // il y en a bien une seconde
    for (const i of apres) {
      expect(coeur.slice(i, i + 200)).toMatch(
        /internal\.notifications\.notify/,
      );
    }
  });

  it("les DEUX notifications de publication partent du cœur partagé", () => {
    // « publiée » et « publiée en retard » sont deux événements distincts, avec
    // deux bascules. Les deux doivent être planifiées ICI et pas dans un wrapper,
    // sinon le lien collé par l'admin en secours n'en déclencherait qu'une.
    expect(coeur).toContain("internal.notifications.notifyPublication");
    expect(coeur).toContain("internal.notifications.notifyLatePublication");
  });
});

describe("revue vidéo — validation et refus notifient, hors transaction", () => {
  const bloc = (nom: string) => {
    const debut = SRC.indexOf(`export const ${nom} = adminMutation`);
    expect(debut).toBeGreaterThan(-1);
    return SRC.slice(debut, debut + 2500);
  };

  it("la validation planifie notifyVideoReviewed avec l'auteur", () => {
    const b = bloc("reviewVideoApprove");
    expect(b).toMatch(
      /scheduler\.runAfter\(\s*0,\s*internal\.notifications\.notifyVideoReviewed/,
    );
    expect(b).toContain("actorUserId: ctx.userId");
    // Pas de motif sur une validation : c'est ce qui distingue les deux events.
    expect(b).not.toContain("rejectionReason");
  });

  it("le refus transmet le MOTIF déjà validé non vide", () => {
    const b = bloc("reviewVideoReject");
    expect(b).toMatch(
      /scheduler\.runAfter\(\s*0,\s*internal\.notifications\.notifyVideoReviewed/,
    );
    expect(b).toContain("rejectionReason: fb");
    expect(b).toContain("actorUserId: ctx.userId");
  });

  it("la validation notifie APRÈS le retour idempotent (re-valider ne renvoie rien)", () => {
    const b = bloc("reviewVideoApprove");
    const idempotent = b.indexOf("alreadyApproved: true");
    const notif = b.indexOf("internal.notifications.notifyVideoReviewed");
    expect(idempotent).toBeGreaterThan(-1);
    expect(notif).toBeGreaterThan(idempotent);
  });
});
