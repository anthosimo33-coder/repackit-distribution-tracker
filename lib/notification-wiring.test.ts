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

/** Corps de `confirmPublicationCore` : de sa signature au premier wrapper qui suit. */
function coeurPublication(): string {
  const debut = SRC.indexOf("async function confirmPublicationCore(");
  const fin = SRC.indexOf("export const confirmPublication = creatorMutation");
  expect(debut).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(debut);
  return SRC.slice(debut, fin);
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

  it("AUCUN throw ne subsiste après la planification", () => {
    // La borne générique, celle qui tiendra face au prochain chantier : quoi
    // qu'on ajoute au cœur, ça doit se placer AVANT la notification si ça peut
    // encore refuser la publication.
    const apres = coeur.slice(
      coeur.indexOf("internal.notifications.notifyPublication"),
    );
    expect(apres).not.toContain("throw ");
  });

  it("elle est la DERNIÈRE planification du cœur", () => {
    // Comparer les index bruts serait tautologique : la ligne de notification
    // contient elle-même « scheduler.runAfter( ». On regarde donc CE QUE plante
    // la dernière planification.
    const appels = [...coeur.matchAll(/scheduler\.runAfter\(/g)].map(
      (m) => m.index ?? 0,
    );
    expect(appels.length).toBeGreaterThan(1); // le cœur en a d'autres (purge Stream)
    const derniere = coeur.slice(Math.max(...appels), Math.max(...appels) + 160);
    expect(derniere).toContain("internal.notifications.notifyPublication");
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
