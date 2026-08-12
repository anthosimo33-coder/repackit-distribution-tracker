import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
// Modules SERVEUR purs (aucun import `_generated`) — chargeables tels quels par
// vitest, comme le fait déjà lib/warmup-mode.test.ts pour convex/warmupMode.
import {
  buildDigestMessage,
  buildGroupedPublicationsMessage,
  buildPublicationMessage,
  buildVideoApprovedMessage,
  buildVideoRejectedMessage,
  publicationLine,
  type PublicationContext,
  type ReviewContext,
  buildDisputeMessage,
  buildGroupedSubmissionsMessage,
  buildRenewalFailedMessage,
  buildSubmissionMessage,
  buildTestMessage,
  daysLate,
  remainingDelay,
  submissionLine,
  validationUrl,
  type DigestSections,
  type SubmissionContext,
} from "../convex/notificationMessage";
import {
  clampToTelegramLimit,
  escapeTelegram,
  TELEGRAM_MAX_CHARS,
} from "../convex/notifyApi";

const BASE = "https://jarvia.example";
const SLUG = "snytch";
const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const DAY = 86_400_000;

const CTX: SubmissionContext = {
  creatorName: "Kelly",
  campaignName: "Campagne Été",
  formatName: "Hook Erreur",
  targets: [
    { platform: "TikTok", accountHandle: "@kelly.repack" },
    { platform: "Instagram", accountHandle: null },
  ],
};

const PUB_CTX: PublicationContext = {
  creatorName: "Kelly",
  campaignName: "Campagne Été",
  formatName: "Hook Erreur",
  targets: [
    {
      platform: "TikTok",
      accountHandle: "@kelly.repack",
      url: "https://www.tiktok.com/@kelly.repack/video/7666925524865830176",
    },
  ],
  byAdmin: false,
};

const REVIEW_CTX: ReviewContext = {
  creatorName: "Kelly",
  campaignName: "Campagne Été",
  formatName: "Hook Erreur",
  actorName: "Anthony",
};

// ─── Transport : échappement et plafond ──────────────────────────────────────

describe("escapeTelegram — mode HTML, 3 caractères seulement", () => {
  it("échappe &, < et >", () => {
    expect(escapeTelegram('a & b <c> "d"')).toBe("a &amp; b &lt;c&gt; \"d\"");
  });
  it("laisse intacts les caractères qui casseraient MarkdownV2", () => {
    // C'est la raison du choix du mode HTML : un pseudo ou un motif de litige
    // contenant . - _ ! ( ) passe sans traitement.
    const raw = "carte_expirée (motif-1). Voir !";
    expect(escapeTelegram(raw)).toBe(raw);
  });
});

describe("clampToTelegramLimit — plafond dur de l'API", () => {
  it("laisse passer un message court", () => {
    expect(clampToTelegramLimit("court")).toBe("court");
  });
  it("tronque au-delà de 4096 et le SIGNALE", () => {
    const out = clampToTelegramLimit("x".repeat(TELEGRAM_MAX_CHARS + 500));
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    expect(out).toContain("tronqué");
  });
  it("un message pile à la limite n'est pas touché", () => {
    const exact = "y".repeat(TELEGRAM_MAX_CHARS);
    expect(clampToTelegramLimit(exact)).toBe(exact);
  });
});

// ─── Délais ──────────────────────────────────────────────────────────────────

describe("remainingDelay — le délai qui rend l'alerte litige utile", () => {
  it("rend jours + heures", () => {
    expect(remainingDelay(NOW + 5 * DAY + 3 * 3_600_000, NOW)).toBe("5 j 3 h");
  });
  it("moins d'un jour → heures seules", () => {
    expect(remainingDelay(NOW + 7 * 3_600_000, NOW)).toBe("7 h");
  });
  it("moins d'une heure → dit en toutes lettres, jamais « 0 h »", () => {
    expect(remainingDelay(NOW + 600_000, NOW)).toBe("moins d'une heure");
  });
  it("échéance passée → null (l'appelant écrit un texte explicite)", () => {
    expect(remainingDelay(NOW - 1, NOW)).toBeNull();
    expect(remainingDelay(NOW, NOW)).toBeNull();
  });
});

describe("daysLate", () => {
  it("compte les jours PLEINS de retard", () => {
    expect(daysLate(NOW - 2 * DAY - 3_600_000, NOW)).toBe(2);
  });
  it("pas en retard → 0, jamais négatif", () => {
    expect(daysLate(NOW + DAY, NOW)).toBe(0);
  });
});

// ─── Soumission ──────────────────────────────────────────────────────────────

describe("buildSubmissionMessage", () => {
  const msg = buildSubmissionMessage({
    ctx: CTX,
    isResubmission: false,
    appBaseUrl: BASE,
    projectSlug: SLUG,
    assignmentId: "abc123",
  });

  it("porte les 5 informations demandées", () => {
    expect(msg).toContain("Kelly");
    expect(msg).toContain("Campagne Été");
    expect(msg).toContain("Hook Erreur");
    expect(msg).toContain("TikTok");
    expect(msg).toContain("@kelly.repack");
  });

  it("lie vers CETTE soumission, pas vers la liste", () => {
    expect(msg).toContain(`${BASE}/admin/${SLUG}/validation?soumission=abc123`);
  });

  it("une cible sans compte connu affiche la plateforme seule", () => {
    expect(msg).toContain("Instagram");
    expect(msg).not.toContain("Instagram · ");
  });

  it("distingue la re-soumission de la première soumission", () => {
    const re = buildSubmissionMessage({
      ctx: CTX,
      isResubmission: true,
      appBaseUrl: BASE,
      projectSlug: SLUG,
      assignmentId: "abc123",
    });
    expect(re).toContain("re-soumise");
    expect(msg).not.toContain("re-soumise");
  });

  it("campagne seule, format seul, ou ni l'un ni l'autre", () => {
    const campagneSeule = buildSubmissionMessage({
      ctx: { ...CTX, formatName: null },
      isResubmission: false,
      appBaseUrl: BASE,
      projectSlug: SLUG,
      assignmentId: "x",
    });
    expect(campagneSeule).toContain("Campagne Été");
    expect(campagneSeule).not.toContain("format :");

    const formatSeul = buildSubmissionMessage({
      ctx: { ...CTX, campaignName: null },
      isResubmission: false,
      appBaseUrl: BASE,
      projectSlug: SLUG,
      assignmentId: "x",
    });
    expect(formatSeul).toContain("Hook Erreur");

    const aucun = buildSubmissionMessage({
      ctx: { ...CTX, campaignName: null, formatName: null, targets: [] },
      isResubmission: false,
      appBaseUrl: BASE,
      projectSlug: SLUG,
      assignmentId: "x",
    });
    expect(aucun).toContain("aucune cible");
  });
});

describe("buildGroupedSubmissionsMessage — le message de fin de fenêtre", () => {
  it("accorde le pluriel et lie vers la LISTE (aucune soumission n'est « la » bonne)", () => {
    const msg = buildGroupedSubmissionsMessage({
      lines: [submissionLine(CTX), submissionLine({ ...CTX, creatorName: "Léa" })],
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("2 autres vidéos à valider");
    expect(msg).toContain("Kelly");
    expect(msg).toContain("Léa");
    expect(msg).toContain(validationUrl(BASE, SLUG));
    expect(msg).not.toContain("?soumission=");
  });

  it("une seule → singulier", () => {
    const msg = buildGroupedSubmissionsMessage({
      lines: [submissionLine(CTX)],
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("1 autre vidéo à valider");
  });

  it("longue liste : plafonnée avec un repli EXPLICITE (jamais une troncature muette)", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Créatrice ${i}`);
    const msg = buildGroupedSubmissionsMessage({
      lines,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("20 autres vidéos à valider");
    expect(msg).toContain("et 12 autres");
    expect(msg).not.toContain("Créatrice 19");
  });
});

// ─── Publication confirmée ───────────────────────────────────────────────────

describe("buildPublicationMessage", () => {
  const msg = buildPublicationMessage({
    ctx: PUB_CTX,
    appBaseUrl: BASE,
    projectSlug: SLUG,
  });

  it("porte créatrice, compte, plateforme, format et campagne", () => {
    expect(msg).toContain("Kelly");
    expect(msg).toContain("@kelly.repack");
    expect(msg).toContain("TikTok");
    expect(msg).toContain("Campagne Été");
    expect(msg).toContain("Hook Erreur");
  });

  it("le lien du post est CLIQUABLE, pas un renvoi vers Jarvia", () => {
    expect(msg).toContain(
      '<a href="https://www.tiktok.com/@kelly.repack/video/7666925524865830176">',
    );
  });

  it("saisie créatrice → pas d'avertissement de secours", () => {
    // Assertion ciblée sur la MENTION, pas sur le mot « admin » : l'URL Jarvia
    // (/admin/<slug>/assignments) le contient forcément.
    expect(msg).not.toContain("saisi par l'admin");
  });

  it("saisie ADMIN en secours → le dit explicitement", () => {
    const parAdmin = buildPublicationMessage({
      ctx: { ...PUB_CTX, byAdmin: true },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(parAdmin).toContain("saisi par l'admin en secours");
  });

  it("un post sans URL connue ne rend aucun lien mort", () => {
    const sansUrl = buildPublicationMessage({
      ctx: { ...PUB_CTX, targets: [{ platform: "TikTok", accountHandle: "@k", url: null }] },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(sansUrl).not.toContain("Voir le post");
    expect(sansUrl).toContain("Ouvrir les missions");
  });

  it("plusieurs plateformes → un lien par post", () => {
    const multi = buildPublicationMessage({
      ctx: {
        ...PUB_CTX,
        targets: [
          { platform: "TikTok", accountHandle: "@k", url: "https://tk/1" },
          { platform: "Instagram", accountHandle: "@k2", url: "https://ig/2" },
        ],
      },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(multi).toContain("Voir le post TikTok");
    expect(multi).toContain("Voir le post Instagram");
  });
});

describe("buildGroupedPublicationsMessage", () => {
  it("groupe la rafale et signale les saisies admin ligne par ligne", () => {
    const msg = buildGroupedPublicationsMessage({
      lines: [
        publicationLine(PUB_CTX),
        publicationLine({ ...PUB_CTX, creatorName: "Léa", byAdmin: true }),
      ],
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("2 autres publications");
    expect(msg).toContain("Kelly");
    expect(msg).toContain("Léa");
    expect(msg).toContain("(saisi par l'admin)");
  });

  it("une seule → singulier", () => {
    const msg = buildGroupedPublicationsMessage({
      lines: [publicationLine(PUB_CTX)],
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("1 autre publication");
  });
});

// ─── Revue vidéo ─────────────────────────────────────────────────────────────

describe("buildVideoApprovedMessage / buildVideoRejectedMessage", () => {
  it("la validation nomme la créatrice, la mission et QUI a validé", () => {
    const msg = buildVideoApprovedMessage({
      ctx: REVIEW_CTX,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("Kelly");
    expect(msg).toContain("Hook Erreur");
    expect(msg).toContain("Validée par Anthony");
  });

  it("le refus rend le MOTIF EN ENTIER, jamais tronqué", () => {
    // Le motif est tout le contenu utile du message : aucun plafond local (seul
    // le plafond global de l'API Telegram s'applique, en dernier recours).
    const motif =
      "Le hook est coupé, on n'entend pas la première phrase. " +
      "Refais la prise en te rapprochant du micro, et garde le cadrage vertical. ".repeat(6);
    const msg = buildVideoRejectedMessage({
      ctx: REVIEW_CTX,
      reason: motif,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain(motif.trim().slice(0, 60));
    expect(msg).toContain("garde le cadrage vertical");
    expect(msg).toContain("Refusée par Anthony");
    expect(msg).not.toContain("…");
  });

  it("un motif à caractères spéciaux est échappé, pas cassé", () => {
    const msg = buildVideoRejectedMessage({
      ctx: REVIEW_CTX,
      reason: "Le <hook> & la fin ne collent pas",
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("&lt;hook&gt; &amp; la fin");
  });

  it("nom d'admin inconnu → repli explicite, JAMAIS un email", () => {
    const msg = buildVideoApprovedMessage({
      ctx: { ...REVIEW_CTX, actorName: null },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("Validée par un administrateur");
  });
});

// ─── Whop ────────────────────────────────────────────────────────────────────

describe("buildDisputeMessage", () => {
  it("porte le délai restant, l'information qui rend l'alerte utile", () => {
    const msg = buildDisputeMessage({
      memberName: "marc_d",
      reason: "fraudulent",
      dueAt: NOW + 5 * DAY,
      now: NOW,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("marc_d");
    expect(msg).toContain("fraudulent");
    expect(msg).toContain("5 j 0 h");
  });

  it("échéance absente → le DIT, n'invente pas un délai", () => {
    const msg = buildDisputeMessage({
      memberName: null,
      reason: null,
      dueAt: null,
      now: NOW,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("délai non communiqué par Whop");
    expect(msg).toContain("inconnu");
    expect(msg).toContain("non précisé");
  });

  it("échéance déjà passée → le dit franchement", () => {
    const msg = buildDisputeMessage({
      memberName: "marc_d",
      reason: "product_not_received",
      dueAt: NOW - DAY,
      now: NOW,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("DÉPASSÉE");
  });
});

describe("buildRenewalFailedMessage", () => {
  it("porte la cause et dit que Whop ne relancera pas", () => {
    const msg = buildRenewalFailedMessage({
      memberName: "marc_d",
      failureMessage: "Votre carte a expiré",
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("Votre carte a expiré");
    expect(msg).toContain("ne relancera pas");
  });

  it("cause absente → le dit, n'invente pas", () => {
    const msg = buildRenewalFailedMessage({
      memberName: null,
      failureMessage: null,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("non communiquée par Whop");
  });
});

// ─── Digest ──────────────────────────────────────────────────────────────────

const EMPTY: DigestSections = {
  overdueMissions: [],
  payCycles: [],
  warmupLate: [],
  retryableRenewalFailures: [],
};

describe("buildDigestMessage", () => {
  it("RIEN à signaler → null, donc AUCUN message envoyé", () => {
    expect(
      buildDigestMessage({
        projectName: "Snytch",
        sections: EMPTY,
        appBaseUrl: BASE,
        projectSlug: SLUG,
      }),
    ).toBeNull();
  });

  it("les renouvellements relançables ont leur ligne — l'arbitrage les déplace, ne les supprime pas", () => {
    const msg = buildDigestMessage({
      projectName: "Snytch",
      sections: {
        ...EMPTY,
        retryableRenewalFailures: [
          { memberName: "marc_d" },
          { memberName: "julie_p" },
        ],
      },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("2 renouvellements en échec");
    expect(msg).toContain("Whop les relancera");
    expect(msg).toContain("marc_d");
  });

  it("une seule section suffit à produire un message", () => {
    const msg = buildDigestMessage({
      projectName: "Snytch",
      sections: { ...EMPTY, retryableRenewalFailures: [{ memberName: "x" }] },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain("1 renouvellement en échec");
    expect(msg).toContain("Whop le relancera");
  });

  it("n'affiche QUE les sections non vides", () => {
    const msg = buildDigestMessage({
      projectName: "Snytch",
      sections: { ...EMPTY, payCycles: [{ creatorName: "Kelly" }] },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain("1 cycle de paiement dû");
    expect(msg).not.toContain("deadline");
    expect(msg).not.toContain("warmup");
  });

  it("trois sections pleines, pluriels accordés", () => {
    const msg = buildDigestMessage({
      projectName: "Snytch",
      sections: {
        overdueMissions: [
          { creatorName: "Kelly", missionLabel: "Campagne Été", daysLate: 2 },
          { creatorName: "Léa", missionLabel: "Hook Volume", daysLate: 1 },
        ],
        payCycles: [{ creatorName: "Kelly" }, { creatorName: "Léa" }],
        warmupLate: [{ handle: "@kelly.repack", missedDays: 3 }],
        retryableRenewalFailures: [],
      },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("2 deadlines de production dépassées");
    expect(msg).toContain("2 cycles de paiement dus");
    expect(msg).toContain("1 compte en warmup en retard");
    expect(msg).toContain("2 jours de retard");
    expect(msg).toContain("1 jour de retard");
    expect(msg).toContain("3 jours manqués");
  });
});

// ─── CONFIDENTIALITÉ — le garde-fou du chantier ──────────────────────────────
//
// Contrainte : « Aucune donnée confidentielle dans les messages. Pas de montant
// de paie individuel, pas d'email de créatrice. » Deux barrières indépendantes :
// on scanne la SORTIE de tous les constructeurs, puis le SOURCE du module.

/** Adresse email : quelque chose@quelque.chose — un @handle TikTok n'en est pas une. */
const EMAIL = /[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i;
/**
 * Les URL sont retirées AVANT le scan d'email : un lien de post contient
 * « tiktok.com/@kelly.repack », qui coche le motif « quelquechose@quelque.chose »
 * sans être une adresse. Sans ce retrait, le garde-fou crierait au loup sur
 * chaque publication et finirait désarmé.
 */
const sansUrl = (t: string) => t.replace(/https?:\/\/\S+/g, " ");
/** Symbole ou code ISO de devise = un montant s'est glissé dans le message. */
const CURRENCY = /[$€£¥]|\b(?:USD|EUR|GBP)\b/i;

/** Tous les messages possibles, construits avec des données réalistes. */
function everyMessage(): string[] {
  const sections: DigestSections = {
    overdueMissions: [
      { creatorName: "Kelly", missionLabel: "Campagne Été", daysLate: 2 },
    ],
    payCycles: [{ creatorName: "Kelly" }, { creatorName: "Léa" }],
    warmupLate: [{ handle: "@kelly.repack", missedDays: 3 }],
    retryableRenewalFailures: [{ memberName: "marc_d" }],
  };
  return [
    buildSubmissionMessage({
      ctx: CTX,
      isResubmission: false,
      appBaseUrl: BASE,
      projectSlug: SLUG,
      assignmentId: "abc",
    }),
    buildSubmissionMessage({
      ctx: CTX,
      isResubmission: true,
      appBaseUrl: BASE,
      projectSlug: SLUG,
      assignmentId: "abc",
    }),
    buildGroupedSubmissionsMessage({
      lines: [submissionLine(CTX)],
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }),
    buildDisputeMessage({
      memberName: "marc_d",
      reason: "fraudulent",
      dueAt: NOW + DAY,
      now: NOW,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }),
    buildRenewalFailedMessage({
      memberName: "marc_d",
      failureMessage: "Votre carte a expiré",
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }),
    buildDigestMessage({
      projectName: "Snytch",
      sections,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }) ?? "",
    buildTestMessage("Snytch"),
    buildPublicationMessage({
      ctx: PUB_CTX,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }),
    buildPublicationMessage({
      ctx: { ...PUB_CTX, byAdmin: true },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }),
    buildGroupedPublicationsMessage({
      lines: [publicationLine(PUB_CTX)],
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }),
    buildVideoApprovedMessage({
      ctx: REVIEW_CTX,
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }),
    buildVideoRejectedMessage({
      ctx: REVIEW_CTX,
      reason: "Le hook est coupé, on n'entend pas la première phrase.",
      appBaseUrl: BASE,
      projectSlug: SLUG,
    }),
  ];
}

describe("aucune donnée confidentielle ne sort dans un message", () => {
  it("aucun message ne contient d'adresse email", () => {
    for (const msg of everyMessage()) {
      expect(sansUrl(msg)).not.toMatch(EMAIL);
    }
  });

  it("aucun message ne contient de montant (symbole ou code devise)", () => {
    for (const msg of everyMessage()) {
      expect(msg).not.toMatch(CURRENCY);
    }
  });

  it("le garde-fou attrape bien une vraie fuite (il n'est pas vide de sens)", () => {
    expect(sansUrl("Contacte kelly@exemple.com")).toMatch(EMAIL);
    // …et le retrait des URL ne doit PAS masquer une vraie adresse voisine.
    expect(
      sansUrl("https://tiktok.com/@k et kelly@exemple.com"),
    ).toMatch(EMAIL);
    // Une URL de post seule ne déclenche rien.
    expect(
      sansUrl("https://www.tiktok.com/@kelly.repack/video/123"),
    ).not.toMatch(EMAIL);
    expect("Dû : 1 240 $").toMatch(CURRENCY);
    // …et ne se déclenche PAS sur un handle réseau social, qui est légitime.
    expect("@kelly.repack").not.toMatch(EMAIL);
  });

  it("les cycles de paiement listent des NOMS, jamais un montant", () => {
    const msg = buildDigestMessage({
      projectName: "Snytch",
      sections: {
        ...EMPTY,
        payCycles: [{ creatorName: "Kelly" }, { creatorName: "Léa" }],
      },
      appBaseUrl: BASE,
      projectSlug: SLUG,
    });
    expect(msg).toContain("Kelly");
    expect(msg).not.toMatch(CURRENCY);
  });
});

describe("le SOURCE des constructeurs ne touche ni la paie ni les emails", () => {
  // Barrière structurelle : les types d'entrée n'exposent aucun champ email ni
  // montant. On le verrouille en scannant le code — une fuite demanderait alors
  // d'ajouter explicitement l'un de ces symboles, ce qui casse le test.
  const src = readFileSync(
    join(process.cwd(), "convex", "notificationMessage.ts"),
    "utf8",
  );

  const INTERDITS: [RegExp, string][] = [
    [/\.email\b/, "accès à un champ email"],
    [/\bformatMoney\s*\(/, "formateur monétaire"],
    [/\bformatAmount\s*\(/, "formateur monétaire"],
    [/\btotalDue\b/, "montant dû d'un cycle de paie"],
    [/\b(?:net|gross|refunded|fee)Amount\b/, "montant de paiement Whop"],
    [/\bpayCurrency\b/, "devise de paie"],
  ];

  for (const [re, quoi] of INTERDITS) {
    it(`ne référence jamais : ${quoi}`, () => {
      expect(src).not.toMatch(re);
    });
  }
});
