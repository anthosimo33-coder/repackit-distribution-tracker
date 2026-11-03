import { describe, it, expect } from "vitest";
import {
  videosApresChangementDeCampagne,
  type VideoExemple,
} from "../convex/videosExemplesCampagne";

const v = (id: string, url = `https://x/${id}`): VideoExemple => ({ id, url, addedAt: 1 });

describe("videosApresChangementDeCampagne", () => {
  // Le cas du 03/11 : mission passée de « Reaction + Demo MUET » à « Collage ».
  const muet = [v("demo"), v("ick"), v("kelly")];
  const collage = [v("gagnante")];

  it("retire les vidéos de l'ancienne campagne et ajoute celles de la nouvelle", () => {
    const r = videosApresChangementDeCampagne(
      [v("m-demo", "https://x/demo"), v("m-ick", "https://x/ick"), v("m-kelly", "https://x/kelly")],
      muet,
      collage,
      20,
    );
    expect(r.next.map((mv) => mv.url)).toEqual(["https://x/gagnante"]);
    expect(r).toMatchObject({ retirees: 3, ajoutees: 1, plafond: false });
  });

  it("garde celles jointes à la main, à leur place", () => {
    const r = videosApresChangementDeCampagne([v("demo"), v("main"), v("ick")], muet, collage, 20);
    expect(r.next.map((mv) => mv.id)).toEqual(["main", "gagnante"]);
  });

  it("une vidéo des deux campagnes reste une fois, avec l'id de la mission", () => {
    const r = videosApresChangementDeCampagne(
      [v("m-demo", "https://x/demo"), v("m-part", "https://x/part")],
      [v("demo"), v("part")],
      [v("part"), v("gagnante")],
      20,
    );
    expect(r.next.map((mv) => mv.id)).toEqual(["m-part", "gagnante"]);
    expect(r).toMatchObject({ retirees: 1, ajoutees: 1 });
  });

  it("déjà présente sur la mission : pas ajoutée deux fois", () => {
    const r = videosApresChangementDeCampagne([v("main"), v("gagnante")], muet, collage, 20);
    expect(r.next.map((mv) => mv.id)).toEqual(["main", "gagnante"]);
    expect(r).toMatchObject({ retirees: 0, ajoutees: 0 });
  });

  it("plafond dépassé : les retraits se font, rien n'est ajouté ni tronqué", () => {
    const pleine = [v("demo"), ...Array.from({ length: 19 }, (_, i) => v(`main${i}`))];
    const r = videosApresChangementDeCampagne(pleine, muet, [v("g1"), v("g2")], 20);
    expect(r.next).toHaveLength(19);
    expect(r.next.some((mv) => mv.id === "demo")).toBe(false);
    expect(r).toMatchObject({ retirees: 1, ajoutees: 0, plafond: true });
  });

  it("ne mute pas la liste de la mission", () => {
    const mission = [v("demo"), v("main")];
    videosApresChangementDeCampagne(mission, muet, collage, 20);
    expect(mission.map((mv) => mv.id)).toEqual(["demo", "main"]);
  });
});
