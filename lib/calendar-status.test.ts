import { describe, it, expect } from "vitest";
import {
  calendarStatus,
  isPastPost,
  isSameLocalDay,
  lateDays,
  onTimeTally,
  parisDayIndex,
  parisHour,
  representativePostedAt,
  CALENDAR_STATUS_LABEL,
  type CalendarStatus,
} from "./calendar-status";

/**
 * Décalage Paris↔UTC à un instant donné, en ms. Dérivé d'`Intl` plutôt que codé
 * en dur : les règles de changement d'heure ne sont pas à réimplémenter ici.
 */
function parisOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  // `hour12: false` rend « 24 » pour minuit sur certains moteurs → % 24.
  const commeSiUtc = Date.UTC(
    g("year"),
    g("month") - 1,
    g("day"),
    g("hour") % 24,
    g("minute"),
    g("second"),
  );
  return commeSiUtc - at;
}

/**
 * ms d'une heure murale PARIS (mois 1-12).
 *
 * ⚠️ Anciennement `new Date(y, mon-1, day, h)` — de l'heure murale LOCALE. Ça
 * marchait tant que le module comparait lui aussi des jours locaux ; il est
 * maintenant épinglé sur Paris (les notifications de retard tournent côté
 * serveur, en UTC). Une fixture en heure locale ferait alors passer ou échouer
 * les tests SELON LE FUSEAU DU RUNNER — c'est-à-dire ne prouverait rien.
 *
 * Avec cette version, tout ce fichier est vert sous `TZ=UTC` comme sous
 * `TZ=Europe/Paris`. C'est la propriété qu'on veut, et elle est vérifiable.
 */
function at(y: number, mon: number, day: number, h = 12): number {
  const approx = Date.UTC(y, mon - 1, day, h, 0, 0, 0);
  return approx - parisOffsetMs(approx);
}

describe("calendarStatus — 4 cas + bords (aucune tolérance)", () => {
  it("none : pas de date de post planifiée", () => {
    expect(
      calendarStatus({ postDate: null, postedAt: null, now: at(2026, 7, 15) }),
    ).toBe("none");
    expect(
      calendarStatus({
        postDate: undefined,
        postedAt: at(2026, 7, 15),
        now: at(2026, 7, 15),
      }),
    ).toBe("none");
  });

  it("à l'heure : publié le jour EXACT (même jour calendaire)", () => {
    // Heures différentes, même jour → à l'heure.
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15, 0),
        postedAt: at(2026, 7, 15, 23),
        now: at(2026, 7, 15),
      }),
    ).toBe("on_time");
  });

  it("à l'heure : indépendant de `now` (post passé jugé à l'heure)", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 10),
        postedAt: at(2026, 7, 10, 9),
        now: at(2026, 7, 30),
      }),
    ).toBe("on_time");
  });

  it("en retard : publié un jour POSTÉRIEUR (J+1)", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15),
        postedAt: at(2026, 7, 16),
        now: at(2026, 7, 16),
      }),
    ).toBe("late");
  });

  it("en retard : publié un AUTRE jour même antérieur (0 tolérance)", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15),
        postedAt: at(2026, 7, 14),
        now: at(2026, 7, 15),
      }),
    ).toBe("late");
  });

  it("en retard : franchit le mois (30/06 prévu → 01/07 publié)", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 6, 30),
        postedAt: at(2026, 7, 1),
        now: at(2026, 7, 1),
      }),
    ).toBe("late");
  });

  it("manqué : jour prévu ENTIÈREMENT passé, aucune publication", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15),
        postedAt: null,
        now: at(2026, 7, 16, 0),
      }),
    ).toBe("missed");
  });

  it("prévu : jour prévu dans le futur, pas de publication", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 20),
        postedAt: null,
        now: at(2026, 7, 15),
      }),
    ).toBe("scheduled");
  });

  it("bord : jour MÊME non encore publié = prévu (journée pas finie)", () => {
    // now = le jour prévu, tard, mais pas encore publié → prévu, PAS manqué.
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15),
        postedAt: null,
        now: at(2026, 7, 15, 23),
      }),
    ).toBe("scheduled");
  });
});

describe("helpers", () => {
  it("isPastPost : postés/manqués sont passés, prévu/none non", () => {
    const past: CalendarStatus[] = ["on_time", "late", "missed"];
    const notPast: CalendarStatus[] = ["scheduled", "none"];
    past.forEach((s) => expect(isPastPost(s)).toBe(true));
    notPast.forEach((s) => expect(isPastPost(s)).toBe(false));
  });

  it("labels : une étiquette FR par statut", () => {
    (
      ["on_time", "late", "missed", "scheduled", "none"] as CalendarStatus[]
    ).forEach((s) => expect(CALENDAR_STATUS_LABEL[s]).toBeTruthy());
  });

  it("isSameLocalDay : même jour vs jours différents", () => {
    expect(isSameLocalDay(at(2026, 7, 15, 0), at(2026, 7, 15, 23))).toBe(true);
    expect(isSameLocalDay(at(2026, 7, 15), at(2026, 7, 16))).toBe(false);
  });
});

describe("representativePostedAt", () => {
  it("plus ancienne target.publishedAt", () => {
    expect(
      representativePostedAt({
        targets: [{ publishedAt: 300 }, { publishedAt: 100 }, { publishedAt: 200 }],
      }),
    ).toBe(100);
  });

  it("ignore les cibles non publiées (null/undefined)", () => {
    expect(
      representativePostedAt({
        targets: [{ publishedAt: null }, { publishedAt: 500 }, {}],
      }),
    ).toBe(500);
  });

  it("fallback sur le legacy top-level publishedAt", () => {
    expect(
      representativePostedAt({ targets: [{ publishedAt: null }], publishedAt: 42 }),
    ).toBe(42);
  });

  it("null si rien de publié", () => {
    expect(representativePostedAt({ targets: [] })).toBeNull();
    expect(representativePostedAt({})).toBeNull();
    expect(
      representativePostedAt({ targets: [{ publishedAt: null }] }),
    ).toBeNull();
  });
});

// ─── Épingle Europe/Paris ────────────────────────────────────────────────────

/**
 * Le jour de référence est désormais épinglé sur Paris et non plus sur le fuseau
 * du processus. Ces assertions sont écrites en TIMESTAMPS ABSOLUS : elles doivent
 * tenir quel que soit le `TZ` du runner — c'est précisément la propriété qui
 * permet aux notifications de retard de tourner côté serveur (runtime Convex en
 * UTC) sans décaler les statuts d'un jour.
 */
describe("parisDayIndex — le jour est celui de Paris, pas celui du processus", () => {
  it("LE PIÈGE : minuit Paris en été, c'est 22:00 UTC LA VEILLE", () => {
    // postDate est stocké à minuit PARIS. Le 12/08/2026 à 00:00 Paris = le
    // 11/08 à 22:00 UTC. Un index calculé en UTC dirait « 11 août » et ferait
    // basculer le statut d'un jour — le défaut corrigé par #51/#52/#54.
    const minuitParis12Aout = Date.UTC(2026, 7, 11, 22, 0);
    expect(parisDayIndex(minuitParis12Aout)).toBe(2026 * 10000 + 7 * 100 + 12);
  });

  it("minuit Paris en HIVER, c'est 23:00 UTC la veille", () => {
    const minuitParis12Janvier = Date.UTC(2026, 0, 11, 23, 0);
    expect(parisDayIndex(minuitParis12Janvier)).toBe(2026 * 10000 + 0 * 100 + 12);
  });

  it("un post planifié à minuit Paris et publié le même jour est À L'HEURE", () => {
    // Le cas complet, en absolu : planifié minuit Paris le 12, publié à 19h Paris
    // le 12 (= 17:00 UTC). Sous un index UTC, le planifié serait le 11 et le
    // publié le 12 → « en retard » pour un post parfaitement à l'heure.
    expect(
      calendarStatus({
        postDate: Date.UTC(2026, 7, 11, 22, 0),
        postedAt: Date.UTC(2026, 7, 12, 17, 0),
        now: Date.UTC(2026, 7, 13, 10, 0),
      }),
    ).toBe("on_time");
  });

  it("le changement d'heure d'octobre ne décale pas le jour", () => {
    // 2026 : bascule le dimanche 25 octobre. Minuit Paris le 26 = 23:00 UTC le 25.
    expect(parisDayIndex(Date.UTC(2026, 9, 25, 23, 0))).toBe(
      2026 * 10000 + 9 * 100 + 26,
    );
    // La veille, encore en heure d'été : minuit Paris le 25 = 22:00 UTC le 24.
    expect(parisDayIndex(Date.UTC(2026, 9, 24, 22, 0))).toBe(
      2026 * 10000 + 9 * 100 + 25,
    );
  });
});

describe("lateDays — le SIGNE du décalage, jamais le statut", () => {
  /** Minuit PARIS d'un jour d'été (= 22:00 UTC la veille), comme postDate. */
  const minuitParis = (m: number, d: number) => Date.UTC(2026, m - 1, d - 1, 22, 0);
  /** Midi Paris (= 10:00 UTC en été), comme une confirmation de publication. */
  const midiParis = (m: number, d: number) => Date.UTC(2026, m - 1, d, 10, 0);

  it("compte les jours pleins de retard", () => {
    expect(
      lateDays({ postDate: minuitParis(8, 12), postedAt: midiParis(8, 15) }),
    ).toBe(3);
    expect(
      lateDays({ postDate: minuitParis(8, 12), postedAt: midiParis(8, 13) }),
    ).toBe(1);
  });

  it("traverse une fin de mois sans se tromper", () => {
    // L'index année*10000+mois*100+jour n'est PAS soustrayable : du 31/01 au
    // 01/02 il vaut 71. La différence doit passer par de vraies dates.
    expect(
      lateDays({
        postDate: Date.UTC(2026, 0, 30, 23, 0), // minuit Paris le 31/01 (hiver)
        postedAt: Date.UTC(2026, 1, 1, 11, 0), // midi Paris le 01/02
      }),
    ).toBe(1);
  });

  it("publié le jour prévu → null, pas 0", () => {
    // 0 se lirait comme « en retard de zéro jour » et déclencherait un message.
    expect(
      lateDays({ postDate: minuitParis(8, 12), postedAt: midiParis(8, 12) }),
    ).toBeNull();
  });

  it("publié EN AVANCE → null (calendarStatus dirait « en retard »)", () => {
    const enAvance = {
      postDate: minuitParis(8, 12),
      postedAt: midiParis(8, 10),
    };
    // Le statut range l'avance dans `late` — correct pour une pastille « hors
    // date », faux pour un message qui annonce des jours de retard.
    expect(calendarStatus({ ...enAvance, now: midiParis(8, 20) })).toBe("late");
    expect(lateDays(enAvance)).toBeNull();
  });

  it("pas publié, ou pas planifié → null", () => {
    expect(lateDays({ postDate: minuitParis(8, 12), postedAt: null })).toBeNull();
    expect(lateDays({ postDate: null, postedAt: midiParis(8, 12) })).toBeNull();
  });
});

describe("onTimeTally — le dénominateur du taux, une seule fois", () => {
  const HIER = at(2026, 8, 12);
  const AVANT_HIER = at(2026, 8, 11);
  const DEMAIN = at(2026, 8, 14);
  const NOW = at(2026, 8, 13);

  it("reproduit le taux du projet relevé en prod : 74/118 = 63 %", () => {
    // Distribution RÉELLE (export prod du 2026-08-14) plutôt que des nombres
    // ronds : 74 à l'heure, 15 en retard, 29 manqués, 33 prévus, et 51
    // assignations sans date de post qui ne comptent nulle part.
    const posts = [
      ...Array.from({ length: 74 }, () => ({ postDate: AVANT_HIER, postedAt: AVANT_HIER })),
      ...Array.from({ length: 15 }, () => ({ postDate: AVANT_HIER, postedAt: HIER })),
      ...Array.from({ length: 29 }, () => ({ postDate: AVANT_HIER, postedAt: null })),
      ...Array.from({ length: 33 }, () => ({ postDate: DEMAIN, postedAt: null })),
      ...Array.from({ length: 51 }, () => ({ postDate: null, postedAt: null })),
    ];
    const t = onTimeTally(posts, NOW);
    expect(t.onTime).toBe(74);
    expect(t.late).toBe(15);
    expect(t.missed).toBe(29);
    expect(t.scheduled).toBe(33);
    expect(t.past).toBe(118);
    expect(Math.round(t.rate! * 100)).toBe(63);
  });

  it("reproduit le taux d'une créatrice : Kelly, 32/35 = 91 %", () => {
    // Le chiffre du projet (63 %) ne décrit personne — c'est le taux par
    // créatrice qui porte l'information, et c'est lui que le message annonce.
    const posts = [
      ...Array.from({ length: 32 }, () => ({ postDate: AVANT_HIER, postedAt: AVANT_HIER })),
      { postDate: AVANT_HIER, postedAt: HIER },
      { postDate: AVANT_HIER, postedAt: HIER },
      { postDate: AVANT_HIER, postedAt: null },
    ];
    const t = onTimeTally(posts, NOW);
    expect(t.past).toBe(35);
    expect(Math.round(t.rate! * 100)).toBe(91);
  });

  it("les posts SANS date de post ne comptent d'AUCUN côté", () => {
    // Ni au numérateur ni au dénominateur : c'est pourquoi le libellé dit
    // « taux de publication à l'heure », et pourquoi l'onglet Fiabilité chiffre
    // à part combien d'assignations sont dans ce cas.
    const t = onTimeTally(
      [
        { postDate: AVANT_HIER, postedAt: AVANT_HIER },
        { postDate: null, postedAt: null },
        { postDate: undefined, postedAt: HIER },
      ],
      NOW,
    );
    expect(t.past).toBe(1);
    expect(t.rate).toBe(1);
  });

  it("aucun post passé → rate null, JAMAIS 0", () => {
    // 0 se lirait « cette créatrice ne publie jamais à l'heure ». `null` se rend
    // en tiret.
    const t = onTimeTally([{ postDate: DEMAIN, postedAt: null }], NOW);
    expect(t.past).toBe(0);
    expect(t.rate).toBeNull();
    expect(t.scheduled).toBe(1);
  });

  it("un post prévu AUJOURD'HUI et pas publié est « prévu », pas « manqué »", () => {
    // La journée n'est pas finie — c'est ce qui permet au bilan de 21 h de dire
    // « pas encore publié » sans mentir.
    const t = onTimeTally([{ postDate: NOW, postedAt: null }], NOW);
    expect(t.scheduled).toBe(1);
    expect(t.missed).toBe(0);
    expect(t.past).toBe(0);
  });
});

describe("parisHour — l'heure du bilan du soir", () => {
  it("rend l'heure de Paris, pas celle d'UTC", () => {
    // 19:00 UTC en été = 21:00 à Paris.
    expect(parisHour(Date.UTC(2026, 7, 12, 19, 0))).toBe(21);
    // 20:00 UTC en hiver = 21:00 à Paris.
    expect(parisHour(Date.UTC(2026, 0, 12, 20, 0))).toBe(21);
  });

  it("l'heure d'hiver et l'heure d'été ne tombent PAS au même instant UTC", () => {
    // C'est toute la raison du cron horaire : une heure UTC fixe glisserait.
    expect(parisHour(Date.UTC(2026, 7, 12, 20, 0))).not.toBe(
      parisHour(Date.UTC(2026, 0, 12, 20, 0)),
    );
  });
});
