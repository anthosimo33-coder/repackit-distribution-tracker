import { describe, it, expect } from "vitest";
import { buildQueries } from "../convex/posthogSync";

/**
 * GARDE — `countryPersons` compte des CLIENTS, et c'est fragile.
 *
 * Le funnel par pays historique attribue chaque étape au pays de SON event.
 * L'achat partant du serveur, il porte l'IP du datacenter et le filtre
 * anti-copie-serveur l'écarte : relevé en prod le 11/09/2026, 14 achats y
 * portent un pays contre 450 clients chez Whop. La dernière colonne est donc
 * inutilisable comme numérateur.
 *
 * `countryPersons` s'en sort en regroupant D'ABORD par personne : son pays vient
 * de ses events CLIENT, ses achats sont comptés d'où qu'ils viennent. Trois
 * propriétés font tout le travail, et aucune ne se voit à l'œil dans un écran —
 * ajouter « par cohérence » un filtre serveur sur l'achat ramènerait la colonne
 * à presque zéro sans casser quoi que ce soit. D'où ce test.
 */

const Q = buildQueries("", "") as Record<string, string>;

/**
 * Le fragment de requête qui va de `debut` à `fin`.
 *
 * Pas « la ligne qui contient X » : `COUNTRY_SEGMENT` est un `coalesce`
 * multi-ligne une fois interpolé, et la clause qui lit le pays s'étale donc sur
 * quatre lignes. Une recherche par ligne lisait la dernière et croyait
 * `argMaxIf` absent.
 */
function fragment(sql: string, debut: string, fin: string): string {
  const i = sql.indexOf(debut);
  const j = sql.indexOf(fin, i);
  return i === -1 || j === -1 ? "" : sql.slice(i, j + fin.length);
}

describe("countryPersons — les trois propriétés qui le font marcher", () => {
  it("compte l'ACHAT sans filtrer les copies serveur", () => {
    const l = fragment(Q.countryPersons, "countIf(event = 'subscription_completed'", "AS n_sub");
    expect(l).toContain("subscription_completed");
    expect(l).not.toContain("server_side");
  });

  it("regroupe par PERSONNE avant de compter", () => {
    expect(Q.countryPersons).toContain("GROUP BY person_id");
  });

  it("lit le pays sur les events CLIENT, jamais sur l'achat serveur", () => {
    const l = fragment(Q.countryPersons, "argMaxIf(", "AS pays");
    expect(l).toContain("argMaxIf");
    expect(l).toContain("server_side");
  });

  it("range sous « (inconnu) » une personne sans event client", () => {
    // `argMaxIf` sans aucune ligne correspondante rend la chaîne VIDE : sans ce
    // repli, ces personnes sortent sous un pays anonyme au lieu d'être nommées.
    // Et elles restent VISIBLES — les répartir inventerait une géographie.
    //
    // L'assertion porte sur la SORTIE (`AS seg`) et pas sur la présence de
    // « (inconnu) » dans la requête : ce libellé figure déjà dans le segment
    // pays par event, donc le chercher partout ne prouvait rien — vérifié en
    // retirant le repli, le test restait vert.
    const sortie = fragment(Q.countryPersons, "SELECT", "AS seg");
    expect(sortie).toContain("pays = ''");
    expect(sortie).toContain("'(inconnu)'");
  });

  it("le funnel par pays historique, LUI, exclut bien les copies serveur", () => {
    // Le contraste est la raison d'être des deux requêtes : si celle-ci cessait
    // de filtrer, le commentaire qui justifie l'autre deviendrait faux.
    expect(Q.funnelCountry).toContain("server_side");
  });
});
