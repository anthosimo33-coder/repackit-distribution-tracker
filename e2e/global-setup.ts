import { cleanupTestData } from "./helpers/cleanup";
import { demarrerFauxBlush } from "./helpers/faux-blush";

async function globalSetup() {
  console.log("🧹 Cleanup avant tests...");
  await cleanupTestData();
  // La fausse API tournage de BLUSH, que le backend local appelle
  // (scripts/convex-local.sh) : toute la durée du run, arrêtée à la fin.
  const port = Number(process.env.BLUSH_TOURNAGE_FAUX_PORT);
  if (port) return demarrerFauxBlush(port);
}

export default globalSetup;
