import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// Module SERVEUR pur (aucun import `_generated`), comme dans
// lib/notification-message.test.ts.
import {
  notifyConfig,
  sendNotification,
  TELEGRAM_MAX_CHARS,
  withProjectTag,
  type NotifyConfig,
} from "../convex/notifyApi";

/**
 * Plusieurs projets peuvent pointer le MÊME groupe Telegram (BLUSH a rejoint le
 * groupe de Snytch le 18/10). Une alerte « Nouvelle vidéo à valider » ne disait
 * pas de quel projet elle venait : seul le lien le trahissait. Le nom du projet
 * est donc posé par le TRANSPORT, sur chaque message, et pas par chacun des
 * constructeurs — un message ajouté demain ne peut pas l'oublier.
 */

const SUBMISSION =
  "🎬 <b>Nouvelle vidéo à valider</b>\n\n<b>Juliette</b> — Campagne Été\n→ TikTok · @juju";

function cfgFor(projectName: string): NotifyConfig {
  return {
    token: "jeton-de-test",
    chatId: "-5183925677",
    appBaseUrl: "https://jarvia.example",
    projectName,
  };
}

/** Remplace fetch et rend le `text` réellement posté à l'API Bot. */
function captureFetch(): { texts: string[] } {
  const sent = { texts: [] as string[] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.texts.push(JSON.parse(init.body).text);
      return new Response("{}", { status: 200 });
    }),
  );
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("withProjectTag — le projet en tête de la 1re ligne", () => {
  it("préfixe le titre, sur la même ligne (c'est elle que montre l'aperçu du téléphone)", () => {
    expect(withProjectTag("BLUSH", SUBMISSION)).toBe(
      "<b>[BLUSH]</b> 🎬 <b>Nouvelle vidéo à valider</b>\n\n<b>Juliette</b> — Campagne Été\n→ TikTok · @juju",
    );
  });

  it("échappe le nom : un « & » ou un « < » ne casse pas le parse_mode HTML", () => {
    expect(withProjectTag("A&B <Co>", "x")).toBe("<b>[A&amp;B &lt;Co&gt;]</b> x");
  });
});

describe("notifyConfig — la config d'envoi porte le nom du projet", () => {
  it("rend le nom passé à côté du jeton et du destinataire", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN_TEST", "jeton");
    vi.stubEnv("APP_BASE_URL", "https://jarvia.example/");
    const cfg = notifyConfig(
      { chatId: "-5183925677", tokenEnvVar: "TELEGRAM_BOT_TOKEN_TEST" },
      "BLUSH",
    );
    expect(cfg?.projectName).toBe("BLUSH");
  });
});

describe("sendNotification — câblage : ce qui part chez Telegram", () => {
  it("le même événement, dans le même groupe, se lit BLUSH ou Snytch", async () => {
    const sent = captureFetch();
    await sendNotification(cfgFor("BLUSH"), SUBMISSION);
    await sendNotification(cfgFor("Snytch"), SUBMISSION);
    expect(sent.texts[0].startsWith("<b>[BLUSH]</b> 🎬")).toBe(true);
    expect(sent.texts[1].startsWith("<b>[Snytch]</b> 🎬")).toBe(true);
  });

  it("le plafond de 4096 caractères s'applique APRÈS le préfixe", async () => {
    const sent = captureFetch();
    await sendNotification(cfgFor("BLUSH"), "x".repeat(TELEGRAM_MAX_CHARS));
    expect(sent.texts[0].length).toBe(TELEGRAM_MAX_CHARS);
    expect(sent.texts[0].startsWith("<b>[BLUSH]</b> x")).toBe(true);
  });
});

describe("aucun envoi Telegram ne contourne sendNotification", () => {
  // Le préfixe vit dans sendNotification : un second `fetch` vers l'API Bot
  // ailleurs dans convex/ enverrait des alertes sans nom de projet.
  it("l'API Bot n'est appelée que depuis convex/notifyApi.ts", () => {
    const dir = join(__dirname, "..", "convex");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "notifyApi.ts")
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("api.telegram.org"));
    expect(offenders).toEqual([]);
  });

  it("la garde voit bien le seul appelant légitime", () => {
    const src = readFileSync(join(__dirname, "..", "convex", "notifyApi.ts"), "utf8");
    expect(src).toContain("api.telegram.org");
  });
});
