/**
 * Remédiation sécurité — config des providers JWT acceptés par ce deployment.
 * CONVEX_SITE_URL est injecté automatiquement par Convex (URL .convex.site du
 * deployment) : les tokens émis par Convex Auth lui-même sont acceptés.
 * Prérequis env sur CHAQUE deployment (dev/test/prod) : JWT_PRIVATE_KEY,
 * JWKS, SITE_URL — cf README §Auth et scripts/generate-jwt-keys.ts.
 */
const authConfig = {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
