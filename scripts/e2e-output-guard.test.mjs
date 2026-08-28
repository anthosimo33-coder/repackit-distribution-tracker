import { describe, it, expect } from "vitest";
import { inspectCommand } from "./e2e-output-guard.mjs";

/**
 * Garde-fou de lecture des résultats e2e. Les commandes testées sont celles
 * réellement tapées dans ce dépôt — dont celle qui m'a fait lire « 2 échecs »
 * au lieu de onze, à l'identique.
 */
const deny = (c) => expect(inspectCommand(c).allow).toBe(false);
const allow = (c) => expect(inspectCommand(c).allow).toBe(true);

describe("REFUS — un récapitulatif tronqué masque les échecs", () => {
  it("la commande EXACTE qui m'a eu : redirection puis tail", () => {
    deny('npx playwright test > /tmp/e2e-final.log 2>&1; echo "EXIT=$?"; tail -4 /tmp/e2e-final.log');
  });
  it("le tube direct, sous toutes ses formes", () => {
    deny("npx playwright test 2>&1 | tail -3");
    deny("npx playwright test | head -20");
    deny("pnpm test:e2e 2>&1 | tail -1");
    deny("npx playwright test e2e/foo.spec.ts 2>&1 | grep -E 'x' | head -5");
  });
});

describe("PASSAGE — ce qui ne tronque pas la fin", () => {
  it("grep sur la ligne de récapitulatif", () => {
    allow('npx playwright test 2>&1 | grep -E "^  [0-9]+ (passed|failed|skipped)"');
  });
  it("redirection seule, relue par grep", () => {
    allow("npx playwright test > /tmp/e2e.log 2>&1");
    allow('grep -E "^  [0-9]+ (passed|failed)" /tmp/e2e.log');
  });
  it("CONTRE-ÉPREUVE — head/tail sans Playwright reste libre", () => {
    allow("tail -20 /var/log/system.log");
    allow("npx vitest run 2>&1 | tail -5");
    allow("git log --oneline | head -10");
  });
  it("une commande qui MENTIONNE playwright sans le lancer", () => {
    allow('git commit -m "docs: ne pas lire playwright test avec tail"');
    allow('grep -rn "playwright test" scripts/ | head -3');
  });
});
