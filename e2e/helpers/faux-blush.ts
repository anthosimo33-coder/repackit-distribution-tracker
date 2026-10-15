/**
 * FAUSSE API TOURNAGE DE BLUSH — le déploiement local l'appelle à la place de
 * askblush.com (BLUSH_TOURNAGE_URL, posée par scripts/convex-local.sh) : les e2e
 * ne paient jamais une lecture.
 *
 * Même contrat que la vraie (convex/scenarioTournageBlush) : Bearer, POST
 * { nom, fichier, moi, ref } (même ref = même lien), GET /<id>, POST
 * /<id>/arreter, 422 si `moi` n'est pas dans le fichier. Un lien reste « en
 * lecture » tant que le test ne le déclare pas prêt (POST /__e2e/pret) ou en
 * échec (POST /__e2e/echec) : les specs qui ne s'en soucient pas ne voient
 * jamais un lien arriver tout seul.
 */
import http from "node:http";

export const CLE_FAUX_BLUSH = "e2e-cle-tournage";

type Lien = {
  id: string;
  ref: string;
  nom: string;
  moi: string;
  fichier: string;
  statut: "en_lecture" | "pret" | "echec";
  erreur?: string;
  arrete: boolean;
};

export function demarrerFauxBlush(port: number): Promise<() => Promise<void>> {
  const liens: Lien[] = [];
  const lire = (req: http.IncomingMessage) =>
    new Promise<Record<string, unknown>>((ok) => {
      let s = "";
      req.on("data", (c) => (s += c));
      req.on("end", () => {
        try {
          ok(s ? (JSON.parse(s) as Record<string, unknown>) : {});
        } catch {
          ok({});
        }
      });
    });
  const serveur = http.createServer(async (req, res) => {
    const repondre = (status: number, corps: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(corps));
    };
    const url = new URL(req.url ?? "/", "http://x");
    const corps = req.method === "POST" ? await lire(req) : {};
    // Pilotage par les specs.
    if (url.pathname === "/__e2e/demandes") return repondre(200, liens);
    if (url.pathname === "/__e2e/pret" || url.pathname === "/__e2e/echec") {
      const l = liens.find((x) => x.ref === corps.ref);
      if (!l) return repondre(404, { erreur: "ref inconnue" });
      l.statut = url.pathname === "/__e2e/pret" ? "pret" : "echec";
      if (l.statut === "echec") l.erreur = String(corps.erreur ?? "échec");
      return repondre(200, l);
    }
    if (req.headers.authorization !== `Bearer ${CLE_FAUX_BLUSH}`) return repondre(401, { erreur: "interdit" });
    const morceaux = url.pathname.split("/").filter(Boolean);
    if (req.method === "POST" && morceaux.length === 0) {
      const { nom, fichier, moi, ref } = corps as Record<string, string>;
      if (!fichier?.includes(`] ${moi}: `)) return repondre(422, { erreur: "moi absent du fichier" });
      const deja = liens.find((x) => x.ref === ref);
      if (deja) return repondre(200, { id: deja.id, nouvelle: false, statut: deja.statut });
      const l: Lien = { id: `t_${liens.length + 1}`, ref, nom, moi, fichier, statut: "en_lecture", arrete: false };
      liens.push(l);
      return repondre(200, { id: l.id, nouvelle: true, statut: "en_lecture" });
    }
    const l = liens.find((x) => x.id === morceaux[0]);
    if (!l) return repondre(404, { erreur: "introuvable" });
    if (req.method === "POST" && morceaux[1] === "arreter") {
      l.arrete = true;
      return repondre(200, { ok: true });
    }
    if (req.method === "GET" && morceaux.length === 1) {
      return repondre(200, {
        id: l.id,
        statut: l.statut,
        ...(l.statut === "pret" ? { lien: `https://askblush.test/tournage/${l.ref}` } : {}),
        ...(l.erreur ? { erreur: l.erreur } : {}),
      });
    }
    return repondre(404, { erreur: "introuvable" });
  });
  return new Promise((ok, ko) => {
    serveur.once("error", ko);
    serveur.listen(port, "127.0.0.1", () => ok(() => new Promise<void>((fin) => serveur.close(() => fin()))));
  });
}

/** Côté spec : les demandes reçues, et piloter un lien. */
export function pilote(port: number) {
  const base = `http://127.0.0.1:${port}/__e2e`;
  const poster = async (chemin: string, corps: unknown) => {
    const r = await fetch(`${base}/${chemin}`, { method: "POST", body: JSON.stringify(corps) });
    if (!r.ok) throw new Error(`faux BLUSH ${chemin} : ${r.status}`);
  };
  return {
    demandes: async () => (await (await fetch(`${base}/demandes`)).json()) as Lien[],
    pret: (ref: string) => poster("pret", { ref }),
    echec: (ref: string, erreur: string) => poster("echec", { ref, erreur }),
  };
}
