import { describe, it, expect } from "vitest";
import {
  inspectCommand,
  splitSegments,
  effectiveCommand,
} from "./convex-guard.mjs";

/**
 * Garde-fou de cible Convex (`scripts/convex-guard.mjs`).
 *
 * Les commandes de test sont celles qui ont RÉELLEMENT été tapées dans ce
 * dépôt — celle de l'incident du 2026-08-27 comprise, à l'identique. Un jeu
 * inventé (« convex deploy », « foo bar ») ne dirait rien des formes qui
 * circulent vraiment : `eval "$(...)" && npx convex deploy --yes`, les chemins
 * `./node_modules/.bin/convex`, et les mentions CITÉES qui ne doivent RIEN
 * déclencher.
 */

const allow = (cmd) => expect(inspectCommand(cmd).allow).toBe(true);
const deny = (cmd) => {
  const v = inspectCommand(cmd);
  expect(v.allow).toBe(false);
  return v.reason;
};

describe("REFUS — convex deploy sans --env-file part en production", () => {
  it("la commande EXACTE de l'incident du 2026-08-27", () => {
    const reason = deny("npx convex deploy --yes");
    expect(reason).toMatch(/PRODUCTION/);
    expect(reason).toMatch(/convex-local\.sh deploy/);
  });

  it("y compris précédée d'un eval qui semble poser l'environnement local", () => {
    // C'est la forme qui a trompé : l'eval a l'air de rediriger la cible.
    // Il ne redirige rien — seul --env-file compte.
    deny('eval "$(./scripts/convex-local.sh env)" && npx convex deploy --yes');
  });

  it("nue, avec pnpm dlx, avec un chemin, avec une variable en tête", () => {
    deny("convex deploy");
    deny("pnpm dlx convex deploy");
    deny("./node_modules/.bin/convex deploy -y");
    deny("CONVEX_DEPLOYMENT=x npx convex deploy");
  });

  it("en milieu de chaîne, derrière un && ou un ;", () => {
    deny("cd /tmp/wt && npx convex deploy");
    deny("git pull; npx convex deploy --yes; echo fini");
  });
});

describe("REFUS — convex run --prod, une migration se garde comme un deploy", () => {
  it("la migration du guide, en écriture", () => {
    const reason = deny(
      `npx convex run --prod migrations:setGuideModuleLocaleFr '{"commit":true}'`,
    );
    expect(reason).toMatch(/convex-prod\.sh run/);
  });

  it("l'ordre des drapeaux n'y change rien", () => {
    deny("npx convex run migrations:auditBonusTiers --prod");
  });
});

describe("PASSAGE — les commandes légitimes ne sont pas gênées", () => {
  it("le déploiement LOCAL, avec sa cible écrite", () => {
    allow("npx convex deploy --env-file .convex-local/env.selfhosted -y");
    allow("npx convex deploy --env-file=.convex-local/env.selfhosted -y");
  });

  it("le wrapper de production", () => {
    allow(
      `./scripts/convex-prod.sh run migrations:setGuideModuleLocaleFr '{"commit":true}'`,
    );
    allow("./scripts/convex-local.sh deploy");
  });

  it("les LECTURES prod restent libres — elles n'écrivent rien", () => {
    allow("npx convex data guideModules --prod --limit 15");
    allow("npx convex export --prod --path /tmp/x.zip");
    allow("npx convex deployments");
  });

  it("convex run LOCAL, et convex dev", () => {
    allow(
      "npx convex run --env-file .convex-local/env.selfhosted migrations:setGuideModuleLocaleFr '{}'",
    );
    allow("npx convex dev --once");
  });

  it("CONTRE-ÉPREUVE — une commande qui MENTIONNE la chaîne sans l'exécuter", () => {
    // Le piège d'un garde naïf par sous-chaîne : ce dépôt DOCUMENTE ces
    // commandes, donc elles apparaissent dans des messages de commit, des
    // greps et des docs. Le mot de commande y est `git`, `grep` ou `echo`.
    allow('git commit -m "docs: ne jamais lancer convex deploy sans cible"');
    allow('grep -rn "convex deploy" scripts/');
    allow('echo "npx convex run --prod migrations:foo"');
    allow("cat scripts/convex-local.sh");
  });

  it("les commandes du quotidien passent", () => {
    allow("pnpm build");
    allow("git status --short");
    allow("npx playwright test e2e/guide-modules.spec.ts");
    allow("");
  });
});

describe("découpage et mot de commande", () => {
  it("un séparateur CITÉ ne coupe pas le segment", () => {
    expect(splitSegments(`git commit -m "a && b"`)).toEqual([
      `git commit -m "a && b"`,
    ]);
  });

  it("&& et ; coupent, les segments vides sautent", () => {
    expect(splitSegments("a && b ; c")).toEqual(["a", "b", "c"]);
  });

  it("les préfixes d'exécution sont traversés jusqu'à la vraie commande", () => {
    expect(effectiveCommand("npx convex deploy").name).toBe("convex");
    expect(effectiveCommand("pnpm exec convex run").name).toBe("convex");
    expect(effectiveCommand("FOO=1 npx convex deploy").name).toBe("convex");
    expect(effectiveCommand("git commit").name).toBe("git");
  });
});
