#!/usr/bin/env node
/**
 * GARDE-FOU DE LECTURE DES RÉSULTATS E2E — refuse de tronquer un récapitulatif
 * Playwright.
 *
 * POURQUOI. Le piège était DÉJÀ écrit dans le dépôt : « ne jamais lire le
 * résumé Playwright avec `tail -1`, ça masque un “1 failed” ». La note existait,
 * et je suis quand même tombé dedans — j'ai lu « 2 échecs » là où il y en avait
 * onze, parce que `tail -4` ne montrait que les deux dernières lignes du
 * récapitulatif. Une note ne protège de rien ; c'est l'argument exact qui a fait
 * poser le garde Convex.
 *
 * CE QUI EST REFUSÉ : une commande qui LANCE Playwright et qui, dans la même
 * ligne, passe par `head` ou `tail` — que ce soit par un tube ou en relisant le
 * fichier de sortie juste après. Les deux formes tronquent, et la seconde est
 * celle qui m'a eu.
 *
 * CE QUI PASSE : `grep` (il ne coupe pas la fin), une redirection vers un
 * fichier sans le tronquer ensuite, et tout `head`/`tail` sans Playwright.
 *
 * Le remplacement à taper est dans le message : filtrer la LIGNE DE
 * RÉCAPITULATIF entière plutôt que les dernières lignes.
 */

/** La commande lance-t-elle réellement la suite ? */
export function runsPlaywright(line) {
  return /(^|[;&|]\s*|\s)(npx\s+|pnpm\s+(run\s+|exec\s+)?)?playwright\s+test\b/.test(
    line ?? "",
  ) || /\b(pnpm|npm|yarn)\s+(run\s+)?test:e2e\b/.test(line ?? "");
}

/** Un `head`/`tail` en position de COMMANDE (pas dans un texte cité). */
export function truncates(line) {
  return /(^|[;&|]\s*)\s*(head|tail)\b/.test(line ?? "");
}

const DENY = [
  "Lire un récapitulatif Playwright tronqué par `head`/`tail` masque les échecs.",
  "",
  "  C'est le piège déjà consigné dans le dépôt : « 2 failed » lu à la place de",
  "  « 11 failed », parce que la fin du résumé tenait sur plus de lignes que le",
  "  `tail` n'en montrait.",
  "",
  "À la place, filtre la LIGNE DE RÉCAPITULATIF, jamais les dernières lignes :",
  "",
  '  npx playwright test 2>&1 | grep -E "^  [0-9]+ (passed|failed|skipped|flaky)"',
  "",
  "Pour garder la sortie complète et la relire ensuite :",
  "",
  "  npx playwright test > /tmp/e2e.log 2>&1",
  '  grep -E "^  [0-9]+ (passed|failed|skipped|flaky)" /tmp/e2e.log',
].join("\n");

export function inspectCommand(line) {
  if (runsPlaywright(line) && truncates(line)) {
    return { allow: false, reason: DENY };
  }
  return { allow: true };
}

if (process.argv[1] && process.argv[1].endsWith("e2e-output-guard.mjs")) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let command = "";
    try {
      command = JSON.parse(raw)?.tool_input?.command ?? "";
    } catch {
      process.exit(0);
    }
    const verdict = inspectCommand(command);
    if (verdict.allow) process.exit(0);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: verdict.reason,
        },
      }),
    );
    process.exit(0);
  });
}
