import { describe, expect, it } from "vitest";
import { DELETED_VIDEO_RETENTION_DAYS, hasSubmittedVideo } from "./assignment-video";

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
