import { describe, it, expect } from "vitest";
import {
  endOfParisDay,
  MissionOpsError,
  planMissionOps,
  type MissionOpsRequest,
  type OpsAssignment,
  type OpsBrick,
  type OpsCampaign,
} from "../convex/missionOpsPlan";

/**
 * Réécriture de missions sur place. Les données ont la FORME de la prod : ids
 * Convex, apostrophes typographiques, emojis, postDate à minuit Paris, échéance
 * à 23:59:59 Paris — un plan qui ne marcherait que sur « a1/b2 » ne prouverait
 * rien.
 */

const KELLY = "md7asxdjckptdzwjek2yey9n7h89kfvg";
const JULIETTE = "md71m3sw4zs10nwrvjcpshhssx8drjbg";
const WEEK = "n977pa79ya874z4gh5sj3r05ps8fk192"; // « Kelly · @thekellychapters_ · semaine du 5/10 🇫🇷 »
const LAB2 = "n979kq3azq4e48nnbhek73573n8dzg6d"; // « Reaction + DEMO LAB 2 🇫🇷 »

/** Minuit Paris du 05/10/2026 (CEST), comme les postDate de l'écran. */
const OCT5 = Date.UTC(2026, 9, 4, 22, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
/** Échéance posée par l'assignation : fin du 10/10, heure de Paris. */
const DUE_OCT10 = Date.UTC(2026, 9, 10, 21, 59, 59);

const campaigns: OpsCampaign[] = [
  { _id: WEEK, name: "Kelly · @thekellychapters_ · semaine du 5/10 🇫🇷", status: "active" },
  { _id: LAB2, name: "Reaction + DEMO LAB 2 🇫🇷", status: "active" },
];

const b = (
  _id: string,
  campaignId: string,
  kind: string,
  content: string,
  extra: Partial<OpsBrick> = {},
): OpsBrick => ({ _id, campaignId, kind, label: content.slice(0, 60), content, active: true, ...extra });

const bricks: OpsBrick[] = [
  b("n5760wx4gsnw803zqabzatgv6n8fktyz", WEEK, "hook", "Il a posté notre photo en story hier. 10 minutes après, il suivait une fille."),
  b("n576n1wjxq389879mrse3chhhs8fkbar", WEEK, "flux", "."),
  b("n57a1ktcw1j5pn5tgffkvfh5fh8fk9gt", WEEK, "cta", "."),
  // Hook DÉSACTIVÉ dans LAB 2 : l'écran refuse de le mettre dans une mission.
  b("n5764p92k1s9w4yxmb79vsh4q98fk1pn", LAB2, "hook", "Il a posté notre photo en story hier. 10 minutes après, il suivait une fille.", { active: false }),
  b("n57fsj4xb3ezv5htqar2y6f5js8dzdp3", LAB2, "flux", "Montrer le profil Instagram de la personne concernée.\nDire que tu as remarqué une personne que tu n’avais jamais vue avant.", { label: "LA NOUVELLE PERSONNE" }),
  b("n5785mqyaz4b5zcr9abwxgk5gx8eagea", LAB2, "cta", "Mon intution avait donc raison", { label: "1" }),
  b("n578xk1sezefpy1tzqe45928298ebp37", LAB2, "cta", "Tous les memes finalement", { label: "3" }),
  b("n5706esxt8kseygx3wsp1wszh18f4hth", LAB2, "notif", "Je t'ai trompé", { label: "1" }),
];

const midi = (extra: Partial<OpsAssignment> = {}): OpsAssignment => ({
  _id: "ms789zx5wc61m37w4ks3kbp65x8fjt2j",
  creatorId: KELLY,
  status: "todo",
  dueDate: DUE_OCT10,
  postDate: OCT5 + DAY,
  comboKey: "n5760wx4gsnw803zqabzatgv6n8fktyz:n576n1wjxq389879mrse3chhhs8fkbar:n57a1ktcw1j5pn5tgffkvfh5fh8fk9gt",
  instructions: "Flux « LA NOUVELLE PERSONNE » :\nMontrer le profil…\n\nLégende : Tous les memes finalement",
  overlayText: "Notif de Mon chéri ❤️ : « Ma copine est pas là ce soir 😏 »",
  targets: [{}, {}],
  scriptCombo: {
    campaignId: WEEK,
    hookBrickId: "n5760wx4gsnw803zqabzatgv6n8fktyz",
    fluxBrickId: "n576n1wjxq389879mrse3chhhs8fkbar",
    ctaBrickId: "n57a1ktcw1j5pn5tgffkvfh5fh8fk9gt",
    assembledScript: "Il a posté notre photo en story hier. 10 minutes après, il suivait une fille.\n\n.\n\n.",
  },
  ...extra,
});

const soir = (extra: Partial<OpsAssignment> = {}): OpsAssignment => ({
  _id: "ms728k1xv34dbbm4nnzhj4rhqx8fkee3",
  creatorId: KELLY,
  status: "todo",
  dueDate: DUE_OCT10,
  postDate: OCT5 + 3 * DAY,
  comboKey: "n57b1cm5dhab1p92fatz89y89h8fkw27:n57fsj4xb3ezv5htqar2y6f5js8dzdp3:n5785mqyaz4b5zcr9abwxgk5gx8eagea",
  targets: [{}, {}],
  scriptCombo: {
    campaignId: LAB2,
    hookBrickId: "n57b1cm5dhab1p92fatz89y89h8fkw27",
    fluxBrickId: "n57fsj4xb3ezv5htqar2y6f5js8dzdp3",
    ctaBrickId: "n5785mqyaz4b5zcr9abwxgk5gx8eagea",
    assembledScript: "Ma sœur m'a dit que son mec suivait aucune fille…\n\nMontrer le profil…\n\nMon intution avait donc raison",
    notifBrickId: "n5706esxt8kseygx3wsp1wszh18f4hth",
    notifText: "Je t'ai trompé",
  },
  ...extra,
});

const moveMidi: MissionOpsRequest = {
  bricksToCreate: [
    { campaignId: LAB2, kind: "notif", content: "Ma copine est pas là ce soir 😏", instruction: "Envoyée par « Mon chéri ❤️ »", active: false },
  ],
  brickTextFixes: [{ brickId: "n5785mqyaz4b5zcr9abwxgk5gx8eagea", from: "intution", to: "intuition" }],
  assignmentRewrites: [
    {
      assignmentId: "ms789zx5wc61m37w4ks3kbp65x8fjt2j",
      expectCreatorId: KELLY,
      expectCampaignId: WEEK,
      combo: {
        campaignId: LAB2,
        hookBrickId: "n5764p92k1s9w4yxmb79vsh4q98fk1pn",
        fluxBrickId: "n57fsj4xb3ezv5htqar2y6f5js8dzdp3",
        ctaBrickId: "n5785mqyaz4b5zcr9abwxgk5gx8eagea",
        notifContent: "Ma copine est pas là ce soir 😏",
      },
      dueOnPostDay: true,
      clearInstructions: true,
      clearOverlayText: true,
    },
  ],
};

const plan = (assignments: OpsAssignment[], request: MissionOpsRequest, extra: { bricks?: OpsBrick[]; campaigns?: OpsCampaign[] } = {}) =>
  planMissionOps({
    bricks: extra.bricks ?? bricks,
    campaigns: extra.campaigns ?? campaigns,
    assignments,
    cooldownDays: 1,
    request,
  });

describe("endOfParisDay — l'échéance telle que l'écran la pose", () => {
  it("rend 23:59:59 heure de Paris (CEST en octobre)", () => {
    expect(endOfParisDay("2026-10-05")).toBe(Date.UTC(2026, 9, 5, 21, 59, 59));
  });

  it("suit le passage à l'heure d'hiver (journée de 25 h le 25/10)", () => {
    expect(endOfParisDay("2026-10-25")).toBe(Date.UTC(2026, 9, 25, 22, 59, 59));
  });

  it("refuse une date qui n'existe pas", () => {
    expect(endOfParisDay("2026-02-30")).toBeNull();
    expect(endOfParisDay("05/10/2026")).toBeNull();
  });
});

describe("planMissionOps — passer une mission dans une autre campagne", () => {
  it("remonte le script depuis les briques de la campagne cible, brique désactivée comprise", () => {
    const p = plan([midi()], moveMidi);
    expect(p.assignmentPatches).toHaveLength(1);
    const { set, clear, after } = p.assignmentPatches[0];
    expect(set.scriptCombo).toEqual({
      campaignId: LAB2,
      hookBrickId: "n5764p92k1s9w4yxmb79vsh4q98fk1pn",
      fluxBrickId: "n57fsj4xb3ezv5htqar2y6f5js8dzdp3",
      ctaBrickId: "n5785mqyaz4b5zcr9abwxgk5gx8eagea",
      // La légende est lue APRÈS sa correction du même passage.
      assembledScript:
        "Il a posté notre photo en story hier. 10 minutes après, il suivait une fille.\n\n" +
        "Montrer le profil Instagram de la personne concernée.\nDire que tu as remarqué une personne que tu n’avais jamais vue avant.\n\n" +
        "Mon intuition avait donc raison",
      editedOnce: true,
      // Notif créée dans le même passage : référence provisoire, résolue à l'écriture.
      notifBrickId: "new:0",
      notifText: "Ma copine est pas là ce soir 😏",
    });
    expect(set.comboKey).toBe("n5764p92k1s9w4yxmb79vsh4q98fk1pn:n57fsj4xb3ezv5htqar2y6f5js8dzdp3:n5785mqyaz4b5zcr9abwxgk5gx8eagea");
    expect(set.comboImposed).toBe(true);
    expect(set.dueDate).toBe(Date.UTC(2026, 9, 6, 21, 59, 59));
    expect(clear).toEqual(["instructions", "overlayText"]);
    expect(after).toMatchObject({ campaign: "Reaction + DEMO LAB 2 🇫🇷", dueDay: "2026-10-06", instructions: null, overlayText: null, notif: "Ma copine est pas là ce soir 😏" });
  });

  it("crée la notif DÉSACTIVÉE avec l'expéditeur en consigne, et corrige la légende en bibliothèque", () => {
    const p = plan([midi()], moveMidi);
    expect(p.brickCreates).toEqual([
      {
        ref: "new:0",
        campaignId: LAB2,
        kind: "notif",
        label: "Ma copine est pas là ce soir 😏",
        content: "Ma copine est pas là ce soir 😏",
        instruction: "Envoyée par « Mon chéri ❤️ »",
        active: false,
      },
    ]);
    expect(p.brickPatches).toEqual([
      {
        id: "n5785mqyaz4b5zcr9abwxgk5gx8eagea",
        set: { content: "Mon intuition avait donc raison" },
        before: { content: "Mon intution avait donc raison", label: "1", instruction: null },
      },
    ]);
  });

  it("ne touche à AUCUNE activation : les briques existantes ne reçoivent ni `active` ni réécriture", () => {
    const p = plan([midi()], moveMidi);
    for (const patch of p.brickPatches) expect(patch.set).not.toHaveProperty("active");
  });

  it("refuse une brique d'une autre campagne (le flux « . » de la campagne d'origine)", () => {
    const request: MissionOpsRequest = {
      assignmentRewrites: [
        {
          ...moveMidi.assignmentRewrites![0],
          combo: { ...moveMidi.assignmentRewrites![0].combo!, fluxBrickId: "n576n1wjxq389879mrse3chhhs8fkbar", notifContent: undefined },
        },
      ],
    };
    expect(() => plan([midi()], request)).toThrow(/n'est pas dans « Reaction \+ DEMO LAB 2 🇫🇷 »/);
  });

  it("refuse une brique du mauvais rôle", () => {
    const request: MissionOpsRequest = {
      assignmentRewrites: [
        {
          ...moveMidi.assignmentRewrites![0],
          combo: { ...moveMidi.assignmentRewrites![0].combo!, ctaBrickId: "n57fsj4xb3ezv5htqar2y6f5js8dzdp3", notifContent: undefined },
        },
      ],
    };
    expect(() => plan([midi()], request)).toThrow(/est un flux, pas un cta/);
  });

  it("refuse la mission d'une autre créatrice, même avec le bon id", () => {
    expect(() => plan([midi({ creatorId: JULIETTE })], moveMidi)).toThrow(MissionOpsError);
    expect(() => plan([midi({ creatorId: JULIETTE })], moveMidi)).toThrow(/autre créatrice/);
  });

  it("refuse une mission déjà publiée", () => {
    expect(() => plan([midi({ targets: [{ publishedAt: OCT5 + DAY + 13 * 3600_000 }, {}] })], moveMidi)).toThrow(/déjà publiée/);
  });

  it("refuse de changer le script d'une vidéo déjà soumise", () => {
    expect(() => plan([midi({ status: "video_submitted" })], moveMidi)).toThrow(/déjà tournée/);
  });

  it("refuse une mission qui n'est pas dans la campagne attendue", () => {
    const ailleurs = midi({ scriptCombo: { ...midi().scriptCombo!, campaignId: "n974td1mz1ssfjkvdqndprbnfd8f5e9j" } });
    expect(() => plan([ailleurs], moveMidi)).toThrow(/est dans/);
  });

  it("refuse une notif introuvable par son texte", () => {
    const request: MissionOpsRequest = { ...moveMidi, bricksToCreate: [] };
    expect(() => plan([midi()], request)).toThrow(/0 notif « Ma copine est pas là ce soir 😏 »/);
  });

  it("avertit — sans bloquer — quand la créatrice a déjà eu ce script", () => {
    const deja = midi({
      _id: "ms722j1xk5aq86h5ve10f1ykvx8et59f",
      status: "published",
      postDate: OCT5 - 11 * DAY,
      targets: [{ publishedAt: OCT5 - 11 * DAY + 3600_000 }],
      comboKey: "n5764p92k1s9w4yxmb79vsh4q98fk1pn:n57fsj4xb3ezv5htqar2y6f5js8dzdp3:n5785mqyaz4b5zcr9abwxgk5gx8eagea",
    });
    const p = plan([midi(), deja], moveMidi);
    expect(p.assignmentPatches).toHaveLength(1);
    expect(p.warnings).toEqual([
      "Mission ms789zx5wc61m37w4ks3kbp65x8fjt2j : même script déjà servi à cette créatrice (ms722j1xk5aq86h5ve10f1ykvx8et59f, published, 2026-09-24).",
    ]);
  });

  it("n'avertit pas pour un script libre", () => {
    expect(plan([midi()], moveMidi).warnings).toEqual([]);
  });
});

describe("planMissionOps — corriger sans changer le script", () => {
  const fixSoir: MissionOpsRequest = {
    frozenTextFixes: [{ assignmentId: "ms728k1xv34dbbm4nnzhj4rhqx8fkee3", expectCreatorId: KELLY, from: "intution", to: "intuition" }],
    assignmentRewrites: [{ assignmentId: "ms728k1xv34dbbm4nnzhj4rhqx8fkee3", expectCreatorId: KELLY, expectCampaignId: LAB2, dueOnPostDay: true }],
  };

  it("corrige le texte figé et l'échéance, sans toucher briques, comboKey ni notif", () => {
    const p = plan([soir()], fixSoir);
    expect(p.assignmentPatches).toHaveLength(1);
    const { set, clear } = p.assignmentPatches[0];
    expect(set).toEqual({
      scriptCombo: { ...soir().scriptCombo, assembledScript: "Ma sœur m'a dit que son mec suivait aucune fille…\n\nMontrer le profil…\n\nMon intuition avait donc raison", editedOnce: true },
      dueDate: Date.UTC(2026, 9, 8, 21, 59, 59),
    });
    expect(set).not.toHaveProperty("comboKey");
    expect(set).not.toHaveProperty("comboImposed");
    expect(clear).toEqual([]);
  });

  it("refuse une correction dont le texte n'est pas dans la mission", () => {
    const request: MissionOpsRequest = { frozenTextFixes: [{ ...fixSoir.frozenTextFixes![0], from: "parano" }] };
    expect(() => plan([soir()], request)).toThrow(/« parano » introuvable/);
  });

  it("refuse correction de texte ET nouveau script sur la même mission", () => {
    const request: MissionOpsRequest = {
      frozenTextFixes: [{ assignmentId: midi()._id, expectCreatorId: KELLY, from: "story", to: "Story" }],
      assignmentRewrites: moveMidi.assignmentRewrites,
      bricksToCreate: moveMidi.bricksToCreate,
    };
    expect(() => plan([midi()], request)).toThrow(/l'un écraserait l'autre/);
  });
});

describe("planMissionOps — rejouable", () => {
  /** L'état de la base APRÈS un passage : ce qu'un second passage relit. */
  function applied(): { bricks: OpsBrick[]; campaigns: OpsCampaign[]; assignments: OpsAssignment[] } {
    const first = plan([midi()], { ...moveMidi, archiveCampaignIds: [WEEK] });
    const ids = new Map(first.brickCreates.map((c) => [c.ref, `n57new${c.ref.slice(4)}aaaaaaaaaaaaaaaaaaaaaaaaaa`]));
    const nextBricks = bricks.map((x) => {
      const patch = first.brickPatches.find((p) => p.id === x._id);
      return patch ? { ...x, ...patch.set } : x;
    });
    for (const c of first.brickCreates) {
      nextBricks.push({ _id: ids.get(c.ref)!, campaignId: c.campaignId, kind: c.kind, label: c.label, content: c.content, active: c.active, instruction: c.instruction });
    }
    const patch = first.assignmentPatches[0];
    const combo = patch.set.scriptCombo!;
    const next: OpsAssignment = {
      ...midi(),
      ...patch.set,
      scriptCombo: { ...combo, notifBrickId: ids.get(combo.notifBrickId!) ?? combo.notifBrickId },
    };
    for (const f of patch.clear) delete next[f];
    return {
      bricks: nextBricks,
      campaigns: campaigns.map((c) => (c._id === WEEK ? { ...c, status: "archived" as const } : c)),
      assignments: [next],
    };
  }

  it("un second passage ne trouve plus rien à écrire", () => {
    const state = applied();
    const second = plan(state.assignments, { ...moveMidi, archiveCampaignIds: [WEEK] }, state);
    expect(second.brickCreates).toEqual([]);
    expect(second.brickPatches).toEqual([]);
    expect(second.assignmentPatches).toEqual([]);
    expect(second.campaignPatches).toEqual([]);
    expect(second.skipped).toHaveLength(4);
  });
});

describe("planMissionOps — archiver la campagne vidée", () => {
  it("archive sans avertissement quand plus aucune mission non publiée n'y est", () => {
    const p = plan([midi()], { ...moveMidi, archiveCampaignIds: [WEEK] });
    expect(p.campaignPatches).toEqual([{ id: WEEK, name: "Kelly · @thekellychapters_ · semaine du 5/10 🇫🇷", set: { status: "archived" } }]);
    expect(p.warnings).toEqual([]);
  });

  it("avertit quand une mission non publiée y reste", () => {
    const p = plan([midi()], { archiveCampaignIds: [WEEK] });
    expect(p.campaignPatches).toHaveLength(1);
    expect(p.warnings).toEqual(["Campagne « Kelly · @thekellychapters_ · semaine du 5/10 🇫🇷 » archivée avec 1 mission(s) non publiée(s) encore dessus."]);
  });
});
