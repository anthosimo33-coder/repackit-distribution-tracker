import { describe, expect, it } from "vitest";
import {
  DELETED_VIDEO_RETENTION_DAYS,
  hasSubmittedVideo,
  joursAvantEffacement,
  refusRattachement,
} from "./assignment-video";

/**
 * « Vidéo envoyée » = un FICHIER rattaché, quel que soit le statut. Cas réel du
 * 05/10/2026 : une mission « à publier » avec sa vidéo (Juliette) — la garde
 * d'avant ne regardait que « vidéo envoyée » / « à refaire » et l'a laissée
 * passer. À l'inverse, une mission de compte géré naît « à publier » SANS
 * vidéo : rien à protéger.
 */
describe("hasSubmittedVideo", () => {
  it("une mission « à publier » avec sa vidéo (fichier ET copie Stream) en a une", () => {
    expect(hasSubmittedVideo({ submittedVideoStorageId: "kg2cz9jyfp8pznhtmabhncq4cd8fq5zn", submittedVideoStreamUid: "fc4aca9f7ef1444c2a01196d3872dd2c" })).toBe(true);
  });

  it("le fichier seul, ou la copie Stream seule, suffisent", () => {
    expect(hasSubmittedVideo({ submittedVideoStorageId: "kg2cz9jyfp8pznhtmabhncq4cd8fq5zn" })).toBe(true);
    expect(hasSubmittedVideo({ submittedVideoStreamUid: "fc4aca9f7ef1444c2a01196d3872dd2c" })).toBe(true);
  });

  it("une mission de compte géré « à publier » sans fichier n'en a pas", () => {
    expect(hasSubmittedVideo({})).toBe(false);
    expect(hasSubmittedVideo({ submittedVideoStorageId: null, submittedVideoStreamUid: null })).toBe(false);
  });

  it("la vidéo d'une mission supprimée reste récupérable 30 jours au moins", () => {
    expect(DELETED_VIDEO_RETENTION_DAYS).toBeGreaterThanOrEqual(30);
  });
});

/**
 * RATTACHER une vidéo archivée : elle reprend le circuit comme si la créatrice
 * venait de l'envoyer — donc seulement sur une mission de LA MÊME créatrice, qui
 * n'a encore rien envoyé (« à faire » / « en cours »). Jamais par-dessus une
 * vidéo : le rattachement ne remplace rien.
 */
describe("refusRattachement", () => {
  const archive = { creatorId: "cr_juliette", storageId: "kg_fichier" };
  const mission = (o: Partial<{ creatorId: string; status: string; submittedVideoStorageId: string; submittedVideoStreamUid: string }>) => ({
    creatorId: "cr_juliette",
    status: "todo",
    ...o,
  });

  it("une mission « à faire » ou « en cours » de la même créatrice, sans vidéo : oui", () => {
    expect(refusRattachement(archive, mission({}))).toBeNull();
    expect(refusRattachement(archive, mission({ status: "in_progress" }))).toBeNull();
  });

  it("une mission qui a déjà une vidéo (fichier ou copie Stream) : refusé", () => {
    expect(refusRattachement(archive, mission({ submittedVideoStorageId: "kg_autre" }))).toBe("deja_une_video");
    expect(refusRattachement(archive, mission({ status: "video_rejected", submittedVideoStreamUid: "uid" }))).toBe("deja_une_video");
    expect(refusRattachement(archive, mission({ status: "to_publish", submittedVideoStorageId: "kg_autre" }))).toBe("deja_une_video");
  });

  it("une autre créatrice : refusé", () => {
    expect(refusRattachement(archive, mission({ creatorId: "cr_sarah" }))).toBe("autre_createatrice");
  });

  it("une mission qui n'attend plus de vidéo : refusé", () => {
    for (const status of ["cancelled", "published", "paid", "to_publish"]) {
      expect(refusRattachement(archive, mission({ status })), status).toBe("statut");
    }
  });

  it("sans fichier d'origine (copie Stream seule), rien ne se rattache", () => {
    expect(refusRattachement({ creatorId: "cr_juliette" }, mission({}))).toBe("fichier_absent");
    expect(refusRattachement({ creatorId: "cr_juliette", storageId: null }, mission({}))).toBe("fichier_absent");
  });
});

describe("joursAvantEffacement", () => {
  const DAY = 86_400_000;
  it("compte les jours entiers restants, arrondis au jour supérieur", () => {
    expect(joursAvantEffacement(1_000 + 30 * DAY, 1_000)).toBe(30);
    expect(joursAvantEffacement(1_000 + 29 * DAY + 1, 1_000)).toBe(30);
    expect(joursAvantEffacement(1_000 + 1, 1_000)).toBe(1);
  });
  it("0 une fois l'échéance passée (la purge du jour l'efface)", () => {
    expect(joursAvantEffacement(1_000, 1_000)).toBe(0);
    expect(joursAvantEffacement(1_000, 5_000)).toBe(0);
  });
});
