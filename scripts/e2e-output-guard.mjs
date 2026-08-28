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
 * DEUXIÈME DÉTENTE, découverte en écrivant ce garde : Playwright préfixe ses
 * lignes de récapitulatif d'échappements ANSI (`ESC[1A ESC[2K`). Un grep ancré
 * en début de ligne rate donc « N failed » et ne voit que la dernière ligne —
 * j'ai annoncé un run vert qui contenait un échec, avec le motif que ce garde
 * recommandait lui-même. Le remplacement est désormais un SCRIPT
 * (`pnpm test:e2e:summary`), pas une commande à recomposer de mémoire : la même
 * leçon que le déploiement Convex, supprimer la raison d'improviser.
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
  "Lire un récapitulatif Playwright à la main masque les échecs — deux fois.",
  "",
  "  1. `head`/`tail` ne montrent qu'un bout : un « 1 failed » placé AVANT la",
  "     ligne « N passed » disparaît. C'est ce qui a fait lire « 2 échecs » là",
  "     où il y en avait onze.",
  "  2. Playwright préfixe ses lignes de résumé d'échappements ANSI, donc un",
  "     grep ancré en début de ligne rate « N failed » et ne voit que la",
  "     dernière ligne — un run rouge y ressemble à un run vert.",
  "",
  "Utilise la commande qui fait les deux correctement :",
  "",
  "  pnpm test:e2e:summary            # toute la suite",
  "  pnpm test:e2e:summary e2e/x.spec.ts",
  "",
  "Elle rend TOUTES les lignes du récapitulatif, propage le code de sortie de",
  "Playwright, et garde la sortie complète dans /tmp/e2e-last.log.",
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
