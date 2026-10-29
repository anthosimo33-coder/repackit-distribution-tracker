import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_URL,
  checkHead,
  parseLsRemote,
  readRemoteHead,
} from "./convex-head-guard.mjs";

/**
 * Garde de tête de `main` avant le push Convex (`scripts/convex-head-guard.mjs`).
 *
 * Le scénario de référence est celui du 2026-10-29 : #434 (parent) et #433
 * (enfant) mergées à 5 s d'écart, deux builds Production en parallèle, et le
 * build du PARENT qui pousse Convex en dernier. Les SHA ci-dessous sont les
 * vrais.
 *
 * Deux étages de tests :
 *   1. la décision (`checkHead`) avec une tête de `main` simulée ;
 *   2. le CÂBLAGE : la vraie `buildCommand` de `vercel.json`, exécutée dans un
 *      shell, avec le vrai script et le vrai `git ls-remote` — redirigé vers un
 *      dépôt local par `url.<x>.insteadOf`, sans aucun chemin de test dans le
 *      script. Seuls `npx` et `pnpm` sont factices : `npx` imite ce que fait
 *      `convex deploy --cmd` (lance la commande dans un shell, s'arrête si elle
 *      échoue, sinon pousse), `pnpm build` peut faire avancer `main` pendant
 *      le « build ». Un garde juste mais mal branché ne protège rien.
 */

const SHA_434 = "d42d186c0000000000000000000000000000434a";
const SHA_433 = "f66cc71803130c027800b57060e49a2c43f91777";
const PROD = { VERCEL_ENV: "production" };
const noSleep = async () => {};

describe("checkHead — la décision", () => {
  it("le commit de tête pousse", async () => {
    const v = await checkHead({
      env: { ...PROD, VERCEL_GIT_COMMIT_SHA: SHA_433 },
      readHead: async () => SHA_433,
      sleep: noSleep,
    });
    expect(v.push).toBe(true);
  });

  it("le build de #434 quand main est déjà sur #433 ne pousse PAS (29/10)", async () => {
    const v = await checkHead({
      env: { ...PROD, VERCEL_GIT_COMMIT_SHA: SHA_434 },
      readHead: async () => SHA_433,
      sleep: noSleep,
    });
    expect(v.push).toBe(false);
    expect(v.message).toContain(SHA_434.slice(0, 7));
    expect(v.message).toContain(SHA_433.slice(0, 7));
  });

  it("hors production, aucun contrôle et aucune lecture de GitHub", async () => {
    for (const VERCEL_ENV of ["preview", "development", undefined]) {
      let read = 0;
      const v = await checkHead({
        env: { VERCEL_ENV, VERCEL_GIT_COMMIT_SHA: SHA_434 },
        readHead: async () => (read++, SHA_433),
        sleep: noSleep,
      });
      expect(v.push).toBe(true);
      expect(read).toBe(0);
    }
  });

  it("production sans VERCEL_GIT_COMMIT_SHA : refus, rien à comparer", async () => {
    const v = await checkHead({
      env: { ...PROD },
      readHead: async () => SHA_433,
      sleep: noSleep,
    });
    expect(v.push).toBe(false);
  });

  it("tête illisible à chaque essai : refus après 3 essais (fermé par défaut)", async () => {
    let read = 0;
    let slept = 0;
    const v = await checkHead({
      env: { ...PROD, VERCEL_GIT_COMMIT_SHA: SHA_433 },
      readHead: async () => {
        read++;
        throw new Error("Could not resolve host: github.com");
      },
      sleep: async () => void slept++,
    });
    expect(v.push).toBe(false);
    expect(v.message).toMatch(/Could not resolve host/);
    expect(read).toBe(3);
    expect(slept).toBe(2);
  });

  it("ref absente du dépôt (ls-remote vide) : refus, pas une tête implicite", async () => {
    const v = await checkHead({
      env: { ...PROD, VERCEL_GIT_COMMIT_SHA: SHA_433 },
      readHead: async () => null,
      sleep: noSleep,
    });
    expect(v.push).toBe(false);
  });

  it("un échec passager puis la bonne tête : pousse", async () => {
    let read = 0;
    const v = await checkHead({
      env: { ...PROD, VERCEL_GIT_COMMIT_SHA: SHA_433 },
      readHead: async () => {
        if (read++ === 0) throw new Error("timeout");
        return SHA_433;
      },
      sleep: noSleep,
    });
    expect(v.push).toBe(true);
  });
});

describe("parseLsRemote — ne prendre QUE refs/heads/main", () => {
  it("ligne exacte", () => {
    expect(parseLsRemote(`${SHA_433}\trefs/heads/main\n`)).toBe(SHA_433);
  });

  it("le motif de ls-remote matche par la FIN : une branche …/refs/heads/main n'est pas main", () => {
    const decoy = `${SHA_434}\trefs/heads/claude/x/refs/heads/main\n`;
    expect(parseLsRemote(decoy)).toBe(null);
    expect(parseLsRemote(decoy + `${SHA_433}\trefs/heads/main\n`)).toBe(SHA_433);
  });

  it("sortie vide", () => {
    expect(parseLsRemote("")).toBe(null);
  });
});

// ─── Dépôt « GitHub » local, et câblage réel ─────────────────────────────────

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_COMMAND = JSON.parse(
  readFileSync(join(ROOT, "vercel.json"), "utf8"),
).buildCommand;

let dir;
let remote;
let fakeBin;
let parent;
let child;

/** git hermétique : ni la config globale de la machine, ni la système. */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const git = (...args) =>
  execFileSync("git", args, {
    cwd: remote,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
    input: "",
  }).trim();
const setMain = (sha) => git("update-ref", "refs/heads/main", sha);

/** L'URL GitHub du script, réécrite vers `target` par la config de git. */
const redirect = (target) => ({
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: `url.${target}.insteadOf`,
  GIT_CONFIG_VALUE_0: REPO_URL,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "convex-head-guard-"));
  remote = join(dir, "github");
  fakeBin = join(dir, "bin");
  mkdirSync(remote);
  mkdirSync(fakeBin);
  git("init", "-q");
  const tree = git("mktree");
  parent = git("commit-tree", tree, "-m", "#434");
  child = git("commit-tree", tree, "-p", parent, "-m", "#433");

  // `convex deploy --cmd '<c>'` : spawnSync(<c>, { shell: true }), crash si le
  // statut n'est pas 0, PUIS push (node_modules/convex/dist/cjs/cli/lib/deploy2.js,
  // runCommand puis runPush). Le faux reproduit exactement cet ordre.
  writeFileSync(
    join(fakeBin, "npx"),
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const a = process.argv.slice(2);
if (a[0] !== "convex" || a[1] !== "deploy" || a[2] !== "--cmd") process.exit(99);
const r = spawnSync(a[3], { shell: true, stdio: "inherit" });
if (r.status !== 0) process.exit(1);
appendFileSync(process.env.FAKE_LOG, "push\\n");
`,
  );
  writeFileSync(
    join(fakeBin, "pnpm"),
    `#!/bin/sh
[ "$1" = "build" ] || exit 98
echo build >> "$FAKE_LOG"
if [ -n "$FAKE_ADVANCE_MAIN_TO" ]; then
  git -C "$FAKE_REMOTE" update-ref refs/heads/main "$FAKE_ADVANCE_MAIN_TO" || exit 97
fi
exit "\${FAKE_BUILD_EXIT:-0}"
`,
  );
  chmodSync(join(fakeBin, "npx"), 0o755);
  chmodSync(join(fakeBin, "pnpm"), 0o755);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Joue la vraie buildCommand ; rend le statut et la trace build/push. */
function runBuild({ env, target = remote }) {
  const log = join(dir, `log-${Math.random().toString(36).slice(2)}`);
  writeFileSync(log, "");
  const r = spawnSync("sh", ["-c", BUILD_COMMAND], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV,
      ...redirect(target),
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_LOG: log,
      FAKE_REMOTE: remote,
      ...env,
    },
  });
  const steps = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { status: r.status, steps, output: r.stdout + r.stderr };
}

describe("readRemoteHead — le vrai git ls-remote", () => {
  it("lit la tête de main du dépôt", async () => {
    setMain(child);
    expect(await readRemoteHead(remote)).toBe(child);
  });

  it("dépôt injoignable : lève, ne rend pas une tête", async () => {
    await expect(readRemoteHead(join(dir, "absent"))).rejects.toThrow();
  });
});

describe("câblage — la buildCommand de vercel.json", () => {
  it("commit de tête : build puis push", () => {
    setMain(child);
    const r = runBuild({ env: { ...PROD, VERCEL_GIT_COMMIT_SHA: child } });
    expect(r.steps).toEqual(["build", "push"]);
    expect(r.status).toBe(0);
  });

  it("commit déjà périmé au départ : ni build ni push", () => {
    setMain(child);
    const r = runBuild({ env: { ...PROD, VERCEL_GIT_COMMIT_SHA: parent } });
    expect(r.steps).toEqual([]);
    expect(r.status).not.toBe(0);
  });

  it("main avance PENDANT le build (29/10) : le build passe, le push est refusé", () => {
    setMain(parent);
    const r = runBuild({
      env: {
        ...PROD,
        VERCEL_GIT_COMMIT_SHA: parent,
        FAKE_ADVANCE_MAIN_TO: child,
      },
    });
    expect(r.steps).toEqual(["build"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain(child.slice(0, 7));
  });

  it("next build en échec : pas de push, même sur la tête", () => {
    setMain(child);
    const r = runBuild({
      env: { ...PROD, VERCEL_GIT_COMMIT_SHA: child, FAKE_BUILD_EXIT: "1" },
    });
    expect(r.steps).toEqual(["build"]);
    expect(r.status).not.toBe(0);
  });

  it(
    "GitHub injoignable en production : ni build ni push",
    () => {
      setMain(child);
      const r = runBuild({
        env: { ...PROD, VERCEL_GIT_COMMIT_SHA: child },
        target: join(dir, "absent"),
      });
      expect(r.steps).toEqual([]);
      expect(r.status).not.toBe(0);
    },
    20_000,
  );

  it("hors production : build et push sans lire GitHub", () => {
    setMain(child);
    const r = runBuild({
      env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: parent },
      target: join(dir, "absent"),
    });
    expect(r.steps).toEqual(["build", "push"]);
    expect(r.status).toBe(0);
  });
});
