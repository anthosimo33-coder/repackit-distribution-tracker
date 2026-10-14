/**
 * Vérifie une BIBLE de scénario avec le moteur de l'app (celui des missions) :
 * erreurs de schéma en clair, puis la conv générée pour un prénom — stats,
 * premier mot partagé, et les dernières lignes (l'écran choc).
 *
 *   npx tsx scripts/verifier-bible.ts docs/scenarios/bibles/bible_A1.json [Prénom] [graine]
 *
 * Code de sortie 1 si la bible est invalide ou si l'export ne finit pas par
 * son écran choc.
 */
import { readFileSync } from "node:fs";
import { lireBible } from "../convex/scenarioBible";
import { genererConversation, statsConversation, statsTexte } from "../convex/scenarioEngine";
import { valeursFiche } from "../convex/scenarioFiche";

const [fichier, prenom = "Kelly", graine = "7"] = process.argv.slice(2);
if (!fichier) {
  console.error("usage : npx tsx scripts/verifier-bible.ts <bible.json> [Prénom] [graine]");
  process.exit(2);
}
const lue = lireBible(readFileSync(fichier, "utf8"), { ficheRequise: true });
if (!lue.ok) {
  console.error(`BIBLE INVALIDE — ${lue.erreurs.length} erreur(s) :`);
  for (const e of lue.erreurs) console.error(`  ${e.chemin || "bible"} : ${e.code}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`);
  process.exit(1);
}
const bible = lue.bible;
const gen = genererConversation(bible, { prenom, graine: Number(graine) });
const stats = statsConversation(gen, [bible.mot_a_vous.mot]);
console.log(statsTexte(bible, gen, stats));
console.log("\n— premiers mots partagés :", stats.motsPartages.map((m) => `${m.mot}×${m.n}`).join(", "));
const lignes = gen.texte.trimEnd().split(/\r?\n/);
const fin = lignes.slice(-bible.ecran_choc.length);
console.log("\n— fin de l'export :");
for (const l of fin) console.log("  " + l);
const attendu = bible.ecran_choc.map((m) => m[2]);
const ok = fin.every((l, i) => l.endsWith(`: ${attendu[i]}`));
if (!ok) {
  console.error("\nL'EXPORT NE FINIT PAS PAR L'ÉCRAN CHOC");
  process.exit(1);
}
const v = valeursFiche(bible)!;
console.log(`\n— fiche : ${v.duree} avec ${v.lui}, ${v.relation} · c'est normal : « ${v.cest_normal} » · question : « ${v.question_chat} »`);
console.log(`\nOK — ${stats.messages} messages, fichier « ${gen.nomFichier} »`);
