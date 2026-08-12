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
