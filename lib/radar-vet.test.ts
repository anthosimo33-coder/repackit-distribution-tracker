import { describe, expect, it } from "vitest";
import { DORMANT_AFTER_MS, DORMANT_EVERY_MS, nextReadAt } from "../convex/radarNetworkMath";
import { accountProof, proofDetail, REJECTED_KEEP_MS, VET_MAX_WAIT_MS, VET_MIN_SHARE, VET_MIN_VIDEOS, vetOutcome, waitedTooLong } from "../convex/radarVetMath";

/**
 * Radar — le filtre d'entrée d'un compte (13/11/2026). Un compte trouvé par une recherche n'entre que s'il POUSSE
 * l'app : son pseudo la porte, sa bio la nomme, ou au moins deux de ses dernières vidéos la citent. Les comptes
 * d'essai sont ceux que le fondateur a montrés ce jour-là, et des comptes relus sur leur page publique.
 */
const NOW = Date.UTC(2026, 10, 13, 15, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const app = (...strong: string[]) => ({ strong });
const DECLIC = app("declicapp");
const HYPER = app("hyperapp");
const SNITCHY = app("snitchy");

describe("Radar — filtre d'entrée : ce qui prouve qu'un compte pousse une app", () => {
  it("son pseudo la porte, ou sa bio la nomme", () => {
    expect(accountProof("kelly.vread", "", [], app("vread"))).toBe("handle");
    expect(accountProof("snitchy_app", null, ["rien"], SNITCHY)).toBe("handle");
    expect(accountProof("lulu.anti.inflamm", "Je mange mieux grâce à Solaia 🌿", [], app("solaia"))).toBe("bio");
    // Le pseudo passe avant la bio, la bio avant les vidéos.
    expect(accountProof("snitchy.fan", "j'utilise snitchy", ["#snitchy", "#snitchy"], SNITCHY)).toBe("handle");
  });

  it("au moins deux de ses dernières vidéos la citent", () => {
    expect(VET_MIN_VIDEOS).toBe(2);
    const dix = (cites: number) => Array.from({ length: 10 }, (_, i) => (i < cites ? `Mon astuce du jour #snitchy ${i}` : `Ma routine du matin ${i}`));
    expect(accountProof("sia.loves.to.read", "", dix(10), SNITCHY)).toBe("videos");
    expect(accountProof("sabrinameals1", "", dix(4), SNITCHY)).toBe("videos");
    expect(accountProof("cloudmedia05", "", dix(2), SNITCHY)).toBe("videos");
    // Une seule sur dix, ou aucune : une mention isolée, pas un compte qui pousse l'app.
    expect(accountProof("scenezyy3", "Funniest TV moments daily", dix(1), SNITCHY)).toBeNull();
    expect(accountProof("anilxoro7", "GOD IS GREAT", dix(0), SNITCHY)).toBeNull();
  });

  it("une seule vidéo suffit si elle fait au moins le tiers de ce qu'il a publié (un compte tout neuf)", () => {
    expect(VET_MIN_SHARE).toBeCloseTo(1 / 3);
    expect(accountProof("w.rizzly.bear", "", ["get the #snitchy app"], SNITCHY)).toBe("videos");
    expect(accountProof("sweet.textss", "", ["get the #snitchy app", "hello"], SNITCHY)).toBe("videos");
    expect(accountProof("trois", "", ["#snitchy", "a", "b"], SNITCHY)).toBe("videos");
    expect(accountProof("quatre", "", ["#snitchy", "a", "b", "c"], SNITCHY)).toBeNull();
    // Rien de publié, rien dans la bio : rien ne le prouve.
    expect(accountProof("vide", "", [], SNITCHY)).toBeNull();
  });

  it("les deux comptes montrés par le fondateur le 13/11/2026 n'entrent pas sous le hashtag prouvé", () => {
    const villa = ["#LaVilla11 ce soir à 20H sur TFX", "Le #declic de Julie 😱 #lavilla", "Coup de théâtre #LaVilla11", "La cérémonie #tfx"];
    expect(accountProof("lavilla_tfx", "💔 #LaVilla11, du lundi au vendredi à 20H sur TFX et TF1+", villa, DECLIC)).toBeNull();
    const medecine = ["Plongeons dans les profondeurs de la médecine", "hyper impressionnant cette opération", "#medecine #chirurgie"];
    expect(accountProof("_hyperr", "Plongeons ensemble dans les profondeurs de la médecine", medecine, HYPER)).toBeNull();
    // Même sous le motif raccourci du 13/11, le compte de l'émission n'entre pas : une seule vidéo sur quatre dit
    // « declic ». Le compte de médecine, lui, entrerait par son pseudo : d'où le hashtag prouvé, « hyperapp ».
    expect(accountProof("lavilla_tfx", "", villa, app("declic"))).toBeNull();
    expect(accountProof("_hyperr", "", medecine, app("hyper"))).toBe("handle");
  });

  it("ce que l'export vers Swarm dit de la preuve d'un compte : son genre, et combien de vidéos citent l'app (14/11/2026)", () => {
    const dix = (cites: number) => Array.from({ length: 10 }, (_, i) => (i < cites ? `Mon astuce du jour #snitchy ${i}` : `Ma routine du matin ${i}`));
    expect(proofDetail("sia.loves.to.read", "", dix(7), SNITCHY, "caption")).toEqual({ by: "videos", cites: 7, of: 10 });
    expect(proofDetail("snitchy_app", null, dix(0), SNITCHY, "caption")).toEqual({ by: "handle", cites: 0, of: 10 });
    expect(proofDetail("lulu", "j'utilise Snitchy chaque jour", dix(1), SNITCHY, "caption")).toEqual({ by: "bio", cites: 1, of: 10 });
    // Entré par une légende, plus rien ne le prouve : null (il sera jugé « hors sujet » à son relevé).
    expect(proofDetail("scenezyy3", "", dix(1), SNITCHY, "caption")).toEqual({ by: null, cites: 1, of: 10 });
    // Choisi à la main ou de la liste de départ, sans preuve dans ses vidéos rangées : on le dit.
    expect(proofDetail("ambassadrice", "", dix(0), SNITCHY, "seed")).toEqual({ by: "seed", cites: 0, of: 10 });
    expect(proofDetail("ambassadrice", "", [], SNITCHY, "manual")).toEqual({ by: "manual", cites: 0, of: 0 });
    // Une preuve l'emporte sur l'origine.
    expect(proofDetail("ambassadrice", "", dix(3), SNITCHY, "seed").by).toBe("videos");
  });

  it("un mot courant de l'app ne compte qu'avec son contexte, comme partout ailleurs", () => {
    const rule = { strong: ["calaiapp"], weak: ["calai"], context: ["calories"] };
    expect(accountProof("lea", "", ["calai m'aide pour mes calories", "calai compte mes calories"], rule)).toBe("videos");
    expect(accountProof("lea", "", ["calai", "calai encore"], rule)).toBeNull();
  });
});

describe("Radar — filtre d'entrée : ce que dit la page publique d'un compte", () => {
  const profil = (videos: string[], user: Record<string, unknown> = {}) =>
    `<html><script>window.__d={"userInfo":${JSON.stringify({ uniqueId: "x", followerCount: 1_840, signature: "", privateAccount: false, ...user })},"videoList":${JSON.stringify(
      videos.map((desc, i) => ({ id: String((BigInt(Math.floor((NOW - i * DAY) / 1000)) << BigInt(32)) + BigInt(i + 1)), desc, playCount: 100 })),
    )}}</script></html>`;
  const page = (text: string) => ({ ok: true as const, text });

  it("prouvé : il entre, avec ses abonnés et sa bio", () => {
    expect(vetOutcome(page(profil(["#snitchy a", "#snitchy b", "autre"], { signature: "Ma bio" })), "lea", SNITCHY)).toEqual({ kind: "proven", proof: "videos", fans: 1_840, bio: "Ma bio" });
    expect(vetOutcome(page(profil([], { signature: "J'utilise snitchy" })), "lea", SNITCHY)).toMatchObject({ kind: "proven", proof: "bio" });
    expect(vetOutcome(page(profil([])), "snitchy.fan", SNITCHY)).toMatchObject({ kind: "proven", proof: "handle" });
  });

  it("non prouvé : il n'entre pas ; un compte privé non plus", () => {
    expect(vetOutcome(page(profil(["#snitchy", "a", "b", "c", "d"])), "lea", SNITCHY)).toEqual({ kind: "unproven", why: "cites" });
    expect(vetOutcome(page(profil(["#snitchy", "#snitchy"], { privateAccount: true })), "lea", SNITCHY)).toEqual({ kind: "unproven", why: "private" });
  });

  it("une page qui ne dit rien de ce compte : son premier relevé le jugera ; une page refusée : à redemander", () => {
    // TikTok ne sert pas la page d'intégration de certains comptes (400), que le fournisseur relève pourtant.
    expect(vetOutcome({ ok: false, kind: "absent" }, "lea", SNITCHY)).toEqual({ kind: "paid" });
    expect(vetOutcome(page(profil([])), "lea", SNITCHY)).toEqual({ kind: "paid" });
    expect(vetOutcome({ ok: false, kind: "suspect" }, "lea", SNITCHY)).toEqual({ kind: "retry" });
    expect(vetOutcome(page("<html>ratelimit triggered</html>"), "lea", SNITCHY)).toEqual({ kind: "retry" });
  });

  it("six heures d'attente : il entre par le relevé payant ; un compte écarté n'est pas revérifié avant 30 jours", () => {
    expect(VET_MAX_WAIT_MS).toBe(6 * HOUR);
    expect(waitedTooLong(NOW - 6 * HOUR + 1, NOW)).toBe(false);
    expect(waitedTooLong(NOW - 6 * HOUR, NOW)).toBe(true);
    expect(REJECTED_KEEP_MS).toBe(30 * DAY);
  });
});

describe("Radar — relevés : un compte endormi est relevé une fois par mois", () => {
  it("chaque semaine jusqu'à 30 jours sans publier, chaque mois au-delà", () => {
    expect([DORMANT_AFTER_MS, DORMANT_EVERY_MS]).toEqual([30 * DAY, 30 * DAY]);
    expect(nextReadAt(NOW - 2 * DAY, NOW) - NOW).toBe(DAY);
    expect(nextReadAt(NOW - 10 * DAY, NOW) - NOW).toBe(3 * DAY);
    expect(nextReadAt(NOW - 20 * DAY, NOW) - NOW).toBe(7 * DAY);
    expect(nextReadAt(NOW - 30 * DAY, NOW) - NOW).toBe(7 * DAY);
    expect(nextReadAt(NOW - 30 * DAY - 1, NOW) - NOW).toBe(30 * DAY);
    expect(nextReadAt(NOW - 200 * DAY, NOW) - NOW).toBe(30 * DAY);
    // Jamais vu publier : dans 3 jours, comme avant.
    expect(nextReadAt(undefined, NOW) - NOW).toBe(3 * DAY);
  });
});
