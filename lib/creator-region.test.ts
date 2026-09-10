import { describe, it, expect } from "vitest";
import {
  REGION_ORDER,
  REGION_LABELS,
  creatorRegion,
  shortZoneLabel,
  localTimeIn,
} from "./creator-region";
import { TIMEZONE_CHOICES } from "./timezone-choices";

/**
 * RÉGION DÉRIVÉE DU FUSEAU — ce que ces tests protègent.
 *
 * Le regroupement de l'écran Créateurs n'a pas de champ en base : il se déduit
 * de `creators.timezone`. Deux façons de le casser sans que rien ne rougisse :
 *
 *   1. répondre une région PLAUSIBLE à un fuseau inconnu (« America/Nassau »
 *      rangé aux États-Unis parce que ça commence par America) — une créatrice
 *      se retrouve dans le mauvais groupe, avec l'air d'être à sa place ;
 *   2. traiter l'ABSENCE de fuseau comme une région ordinaire, ou pire, la
 *      replier sur Paris — c'est exactement l'interdit que le schéma écrit noir
 *      sur blanc, et le groupe « non renseigné » est précisément la file de
 *      travail qu'on veut voir.
 *
 * Les entrées ont la FORME de la prod : identifiants IANA réels, y compris le
 * cas à trois segments (Buenos Aires) et le fuseau confirmé par le navigateur
 * d'une créatrice, qui n'est pas dans le sélecteur admin.
 */
describe("creatorRegion", () => {
  it("range chaque fuseau du sélecteur admin dans sa région", () => {
    // Les sept fuseaux américains sont UNE région, pas sept : « quelle heure
    // est-il chez elle » est une info de LIGNE, « où est-elle » une info de
    // GROUPE. Les confondre redonnerait sept sections d'une personne.
    expect(creatorRegion("America/New_York")).toBe("us");
    expect(creatorRegion("America/Los_Angeles")).toBe("us");
    expect(creatorRegion("Pacific/Honolulu")).toBe("us");
    expect(creatorRegion("America/Toronto")).toBe("canada");
    expect(creatorRegion("America/Sao_Paulo")).toBe("latam");
    expect(creatorRegion("America/Argentina/Buenos_Aires")).toBe("latam");
    expect(creatorRegion("Europe/Paris")).toBe("europe");
    expect(creatorRegion("Australia/Sydney")).toBe("oceania");
  });

  it("aucun fuseau du sélecteur ne retombe sur le fourre-tout", () => {
    // Le jour où quelqu'un ajoute une ville au sélecteur, `tsc` exige déjà sa
    // région. Ce test attrape l'autre moitié : une région écrite mais que la
    // résolution n'atteint pas (faute de frappe dans la clé, doublon).
    for (const c of TIMEZONE_CHOICES) {
      expect(creatorRegion(c.zone), c.zone).toBe(c.region);
      expect(creatorRegion(c.zone), c.zone).not.toBe("other");
    }
  });

  it("connaît les fuseaux confirmés par un navigateur, hors sélecteur", () => {
    // Le chemin réel : `confirmMyTimezone` écrit ce que le navigateur annonce.
    // Aucun de ces trois n'est proposé à l'admin, tous les trois sont plausibles.
    expect(creatorRegion("America/Santiago")).toBe("latam");
    expect(creatorRegion("America/Mexico_City")).toBe("latam");
    expect(creatorRegion("America/Detroit")).toBe("us");
    expect(creatorRegion("Europe/Lisbon")).toBe("europe");
    expect(creatorRegion("Asia/Dubai")).toBe("asia");
    expect(creatorRegion("Africa/Casablanca")).toBe("africa");
    expect(creatorRegion("Pacific/Auckland")).toBe("oceania");
  });

  it("ne DEVINE pas : un America/* inconnu va dans « autre », pas aux US", () => {
    // L'assertion d'absence (ce n'est pas « us ») ET celle de présence (c'est
    // bien « other ») : sans la seconde, une résolution qui rendrait `undefined`
    // passerait le test tout en cassant le regroupement.
    expect(creatorRegion("America/Nassau")).not.toBe("us");
    expect(creatorRegion("America/Nassau")).toBe("other");
    expect(creatorRegion("Atlantic/Reykjavik")).toBe("other");
  });

  it("l'absence de fuseau est sa PROPRE région, jamais un repli sur Paris", () => {
    for (const vide of [undefined, null, ""]) {
      expect(creatorRegion(vide)).toBe("unknown");
      expect(creatorRegion(vide)).not.toBe("europe");
    }
    // Et elle est nommée pour ce qu'elle est : une fiche à compléter.
    expect(REGION_LABELS.unknown).toMatch(/non renseigné/i);
  });

  it("« non renseigné » ferme la marche — c'est une file, pas une région", () => {
    expect(REGION_ORDER[REGION_ORDER.length - 1]).toBe("unknown");
    // Chaque région atteignable a un libellé, sinon un groupe s'afficherait
    // avec sa clé technique.
    for (const k of REGION_ORDER) expect(REGION_LABELS[k]).toBeTruthy();
  });
});

describe("shortZoneLabel", () => {
  it("retire le pays, déjà porté par le titre de groupe", () => {
    expect(shortZoneLabel("America/Sao_Paulo")).toBe("São Paulo");
    expect(shortZoneLabel("Europe/Paris")).toBe("Paris");
    expect(shortZoneLabel("America/New_York")).toBe("New York");
    expect(shortZoneLabel("America/Phoenix")).toBe("Phoenix");
  });

  it("rend lisible un fuseau hors liste plutôt que son identifiant brut", () => {
    expect(shortZoneLabel("America/Mexico_City")).toBe("Mexico City");
    expect(shortZoneLabel("America/Santiago")).toBe("Santiago");
  });
});

describe("localTimeIn", () => {
  it("rend l'heure du fuseau demandé, pas celle du processus", () => {
    // 2026-09-08T12:00:00Z — été boréal : Paris est à UTC+2, New York à UTC−4.
    // Un instant FIXE, jamais `Date.now()` : un test qui dépend de l'heure du
    // runner ne prouve rien deux fois de suite.
    const t = Date.parse("2026-09-08T12:00:00Z");
    expect(localTimeIn("Europe/Paris", t)).toBe("14:00");
    expect(localTimeIn("America/New_York", t)).toBe("08:00");
    expect(localTimeIn("America/Sao_Paulo", t)).toBe("09:00");
  });

  it("rend null sur un fuseau illisible, jamais l'heure de l'équipe", () => {
    expect(localTimeIn("Pas/Un_Fuseau")).toBeNull();
  });
});
