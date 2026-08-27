#!/usr/bin/env node
/**
 * GARDE-FOU DE CIBLE CONVEX — refuse, AVANT exécution, les commandes Convex qui
 * partent en production sans le dire.
 *
 * POURQUOI. `convex deploy --help` l'écrit noir sur blanc : « By default, this
 * deploys to your **prod** deployment ». Ce n'est pas un environnement mal
 * réglé — `CONVEX_DEPLOYMENT` pointe le dev et n'y change rien. La commande
 * s'appelle « deploy » et elle veut dire « en production ».
 *
 * Le 2026-08-27, un `npx convex deploy` destiné au backend e2e local est parti
 * sur la prod avec du code VOLONTAIREMENT cassé (une contre-épreuve de test).
 * Le front de production attendait un tableau et recevait un objet : la page
 * « Comment ça marche » a été dégradée pour les créateurs pendant deux minutes.
 * Une règle écrite n'aurait rien empêché — c'était une omission, pas une
 * décision. D'où un garde qui INTERCEPTE au lieu de déconseiller.
 *
 * DEUX INTERDITS, et rien de plus :
 *   1. `convex deploy` SANS `--env-file` — dans ce dépôt, personne n'a de raison
 *      légitime de le taper : les déploiements de production sont le travail de
 *      Vercel, au merge, et le backend local se déploie par le script dédié.
 *   2. `convex run --prod` en direct — une migration mérite la même garde qu'un
 *      déploiement. Le passage obligé est `scripts/convex-prod.sh`, qui affiche
 *      la cible et exige une confirmation nominative.
 *
 * CE QUI N'EST PAS GARDÉ, délibérément : les lectures prod (`convex data`,
 * `convex export`, `convex deployments`) et tout ce qui porte déjà `--env-file`.
 * Un garde qui crie sur des commandes inoffensives finit désactivé — c'est la
 * même règle que la garde i18n.
 *
 * PRÉCISION DU MATCH. On ne cherche PAS la sous-chaîne « convex deploy » dans la
 * ligne : `git commit -m "docs: convex deploy"` la contient et n'est pas un
 * déploiement. La ligne est découpée en segments shell (`;` `&&` `||` `|`, en
 * respectant les guillemets), et seul le MOT DE COMMANDE de chaque segment est
 * examiné. Un texte cité est un ARGUMENT de `git` : il ne déclenche rien.
 *
 * Utilisé comme hook `PreToolUse` sur Bash (.claude/settings.json) : lit le JSON
 * du hook sur stdin, rend une décision de permission sur stdout. Testé par
 * scripts/convex-guard.test.mjs.
 */

/** Préfixes qui ne font que porter la vraie commande (`npx convex …`). */
const RUNNERS = new Set(["npx", "bunx", "pnpx", "sudo", "command", "time"]);
/** Formes « gestionnaire de paquets + sous-commande d'exécution ». */
const RUNNER_PAIRS = new Set(["pnpm exec", "pnpm dlx", "yarn dlx", "bun x"]);

/**
 * Découpe une ligne shell en segments exécutables, en respectant les
 * guillemets simples et doubles. Le but n'est pas de parser bash — c'est
 * d'éviter qu'un `&&` ou un `;` CITÉ ne crée un faux segment.
 */
export function splitSegments(line) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      current += c;
      if (c === quote && line[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === ";" || c === "\n" || c === "|" || c === "&") {
      segments.push(current);
      current = "";
      // `&&` et `||` : on avale le second caractère.
      if (line[i + 1] === c) i++;
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Jetons d'un segment, guillemets retirés. */
function tokenize(segment) {
  const tokens = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return tokens.map((t) => t.replace(/^["']|["']$/g, ""));
}

/**
 * Commande effective d'un segment : on saute les préfixes d'exécution et les
 * affectations de variables d'environnement en tête (`FOO=bar cmd …`).
 */
export function effectiveCommand(segment) {
  let tokens = tokenize(segment);
  for (;;) {
    if (tokens.length === 0) return { name: null, args: [] };
    const [first, second] = tokens;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      tokens = tokens.slice(1);
      continue;
    }
    if (second !== undefined && RUNNER_PAIRS.has(`${first} ${second}`)) {
      tokens = tokens.slice(2);
      continue;
    }
    if (RUNNERS.has(first)) {
      tokens = tokens.slice(1);
      continue;
    }
    break;
  }
  // Un chemin (./node_modules/.bin/convex) compte comme la commande `convex`.
  const name = tokens[0].split("/").pop();
  return { name, args: tokens.slice(1) };
}

const LOCAL_ENV_FILE = ".convex-local/env.selfhosted";

const DENY_DEPLOY = [
  "convex deploy SANS --env-file : cette commande déploie en PRODUCTION.",
  "",
  "  « By default, this deploys to your prod deployment » (convex deploy --help).",
  "  CONVEX_DEPLOYMENT pointe le dev et n'y change RIEN.",
  "",
  "À la place :",
  "  • backend e2e local  →  ./scripts/convex-local.sh deploy",
  "  • production         →  c'est le travail de Vercel, au merge d'une PR.",
  "",
  "Et jamais, nulle part, de code volontairement cassé : une contre-épreuve de",
  "test se joue en LOCAL, on restaure depuis une copie faite avant le cassage.",
].join("\n");

const DENY_RUN_PROD = [
  "convex run --prod en direct : une migration mérite la même garde qu'un deploy.",
  "",
  "À la place :",
  "  ./scripts/convex-prod.sh run <fonction> ['<args json>']",
  "",
  "Le wrapper AFFICHE la cible et exige une confirmation nominative avant",
  "d'écrire quoi que ce soit en production.",
].join("\n");

/**
 * Décision pour UNE ligne de commande complète.
 * Rend `{ allow: true }` ou `{ allow: false, reason }`.
 */
export function inspectCommand(line) {
  for (const segment of splitSegments(line ?? "")) {
    const { name, args } = effectiveCommand(segment);
    if (name !== "convex") continue;
    const sub = args.find((a) => !a.startsWith("-"));
    const hasEnvFile = args.some(
      (a) => a === "--env-file" || a.startsWith("--env-file="),
    );
    if (sub === "deploy" && !hasEnvFile) {
      return { allow: false, reason: DENY_DEPLOY };
    }
    if (sub === "run" && args.includes("--prod")) {
      return { allow: false, reason: DENY_RUN_PROD };
    }
  }
  return { allow: true };
}

export { LOCAL_ENV_FILE };

// ─── Point d'entrée hook ─────────────────────────────────────────────────────

function isMain() {
  return process.argv[1] && process.argv[1].endsWith("convex-guard.mjs");
}

if (isMain()) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let command = "";
    try {
      command = JSON.parse(raw)?.tool_input?.command ?? "";
    } catch {
      // Charge illisible : on ne bloque RIEN. Un garde qui casse toutes les
      // commandes au premier JSON inattendu serait retiré le jour même.
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
