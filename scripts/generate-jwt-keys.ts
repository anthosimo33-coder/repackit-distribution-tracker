import { generateKeyPairSync } from "crypto";

/**
 * Remédiation sécurité — génère la paire de clés JWT requise par Convex Auth
 * sur CHAQUE deployment (dev / test / prod). Équivalent du wizard officiel
 * `npx @convex-dev/auth`, en crypto Node native (pas de dépendance jose).
 *
 * Usage :
 *   pnpm tsx scripts/generate-jwt-keys.ts
 *
 * Puis copier les deux commandes affichées (convex env set …). Le README
 * §Auth documente la procédure complète par deployment. Convention Convex
 * Auth : la clé privée PKCS8 est stockée avec les retours à la ligne
 * remplacés par des espaces (la lib les restaure).
 */
function main() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const pkcs8 = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()
    .trimEnd()
    .replace(/\n/g, " ");

  const jwk = publicKey.export({ format: "jwk" });
  const jwks = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });

  console.log("Clés générées. Sur le deployment cible, exécuter :\n");
  console.log(
    `./node_modules/.bin/convex env set JWT_PRIVATE_KEY -- "${pkcs8}"`,
  );
  console.log();
  console.log(`./node_modules/.bin/convex env set JWKS -- '${jwks}'`);
  console.log();
  console.log(
    "(ajouter --prod pour la production ; SITE_URL et E2E_SECRET sont à définir séparément, cf README §Auth)",
  );
}

main();
