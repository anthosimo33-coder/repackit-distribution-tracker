import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSIONS,
  RPC,
  ToolError,
  bearerToken,
  handleMcpHttp,
  handleMcpMessage,
  textResult,
  validateArgs,
  type McpServer,
  type ToolInputSchema,
} from "../convex/mcpProtocol";
import { promptsJarvia } from "../convex/mcpPrompts";

const SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    projet: { type: "string", description: "p" },
    plateforme: { type: "string", description: "p", enum: ["TikTok", "Instagram"] },
    limite: { type: "integer", description: "l", minimum: 1, maximum: 500 },
    inclure: { type: "boolean", description: "i" },
  },
  additionalProperties: false,
};

/** Serveur factice : un outil qui répond, un qui refuse, un qui plante. */
function serveur(): McpServer & { appels: string[] } {
  const appels: string[] = [];
  return {
    appels,
    info: { name: "jarvia", version: "1.0.0" },
    instructions: "lecture seule",
    tools: [
      { name: "comptes", title: "Comptes", description: "d", inputSchema: SCHEMA },
      { name: "refus", title: "Refus", description: "d", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      { name: "panne", title: "Panne", description: "d", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    ],
    async callTool(name, args) {
      appels.push(name);
      if (name === "refus") throw new ToolError("Refusé : droit manquant (Comptes).");
      if (name === "panne") throw new Error("stack interne /convex/secret.ts:42");
      return textResult(JSON.stringify({ recu: args }));
    },
  };
}

const req = (id: number | string | undefined, method: string, params?: unknown) =>
  ({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, ...(params ? { params } : {}) });

describe("initialize — négociation de version", () => {
  it("rend la version demandée quand on la connaît, la plus récente sinon", async () => {
    const s = serveur();
    const ancienne = await handleMcpMessage(s, req(1, "initialize", { protocolVersion: "2025-03-26" }));
    expect(ancienne).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26" } });
    const inconnue = await handleMcpMessage(s, req(2, "initialize", { protocolVersion: "2099-01-01" }));
    expect(inconnue).toMatchObject({ result: { protocolVersion: PROTOCOL_VERSIONS[0] } });
  });

  it("annonce les outils, l'identité et les instructions", async () => {
    const r = await handleMcpMessage(serveur(), req(1, "initialize", { protocolVersion: "2025-06-18" }));
    expect(r).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "jarvia", version: "1.0.0" },
        instructions: "lecture seule",
      },
    });
  });
});

describe("notifications et réponses du client — jamais de réponse", () => {
  it("une notification (sans id) ne rend rien, même inconnue", async () => {
    expect(await handleMcpMessage(serveur(), req(undefined, "notifications/initialized"))).toBeNull();
    expect(await handleMcpMessage(serveur(), req(undefined, "notifications/quelconque"))).toBeNull();
  });

  it("une réponse du client (result sans method) ne rend rien", async () => {
    expect(await handleMcpMessage(serveur(), { jsonrpc: "2.0", id: 9, result: {} })).toBeNull();
  });
});

describe("tools/list et tools/call", () => {
  it("liste les outils, tous marqués lecture seule", async () => {
    const r = (await handleMcpMessage(serveur(), req(1, "tools/list"))) as { result: { tools: { name: string; annotations: unknown }[] } };
    expect(r.result.tools.map((t) => t.name)).toEqual(["comptes", "refus", "panne"]);
    for (const t of r.result.tools) {
      expect(t.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    }
  });

  it("un outil d'écriture le déclare : Claude demande l'accord avant de l'appeler", async () => {
    const s = serveur();
    const ecrire = {
      name: "ventiler_virement",
      title: "Ventiler",
      description: "d",
      inputSchema: { type: "object" as const, properties: {}, additionalProperties: false as const },
      annotations: { readOnlyHint: false as const, destructiveHint: false, idempotentHint: true },
    };
    const r = (await handleMcpMessage({ ...s, tools: [...s.tools, ecrire] }, req(1, "tools/list"))) as {
      result: { tools: { name: string; annotations: unknown }[] };
    };
    const parNom = new Map(r.result.tools.map((t) => [t.name, t.annotations]));
    expect(parNom.get("ventiler_virement")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    // Présence : les outils de lecture, eux, restent marqués lecture seule.
    expect(parNom.get("comptes")).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  it("appelle l'outil avec ses arguments", async () => {
    const s = serveur();
    const r = await handleMcpMessage(s, req(3, "tools/call", { name: "comptes", arguments: { projet: "snytch", limite: 5 } }));
    expect(r).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: textResult(JSON.stringify({ recu: { projet: "snytch", limite: 5 } })),
    });
    expect(s.appels).toEqual(["comptes"]);
  });

  it("un argument invalide est une erreur d'OUTIL (lisible), l'outil n'est pas appelé", async () => {
    const s = serveur();
    const r = await handleMcpMessage(s, req(4, "tools/call", { name: "comptes", arguments: { plateforme: "Snap" } }));
    expect(r).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: textResult("« plateforme » doit valoir : TikTok, Instagram.", true),
    });
    expect(s.appels).toEqual([]);
  });

  it("un refus métier est dit tel quel ; une panne interne ne fuit pas", async () => {
    const refus = await handleMcpMessage(serveur(), req(5, "tools/call", { name: "refus" }));
    expect(refus).toMatchObject({ result: { isError: true, content: [{ text: "Refusé : droit manquant (Comptes)." }] } });
    const panne = await handleMcpMessage(serveur(), req(6, "tools/call", { name: "panne" }));
    expect(panne).toMatchObject({ result: { isError: true, content: [{ text: "Erreur interne de l'outil." }] } });
    expect(JSON.stringify(panne)).not.toContain("secret.ts");
  });

  it("outil inconnu et méthode inconnue : erreurs de protocole", async () => {
    expect(await handleMcpMessage(serveur(), req(7, "tools/call", { name: "supprimer_tout" }))).toMatchObject({
      id: 7,
      error: { code: RPC.INVALID_PARAMS },
    });
    expect(await handleMcpMessage(serveur(), req(8, "resources/list"))).toMatchObject({
      id: 8,
      error: { code: RPC.METHOD_NOT_FOUND },
    });
  });

  it("un lot rend une réponse par requête, et ignore ses notifications", async () => {
    const r = await handleMcpMessage(serveur(), [req(1, "ping"), req(undefined, "notifications/initialized"), req(2, "ping")]);
    expect(r).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
  });
});

describe("validateArgs", () => {
  it("types, bornes, énumérations, arguments inconnus", () => {
    expect(validateArgs(SCHEMA, { projet: "snytch", limite: 10, inclure: true })).toBeNull();
    expect(validateArgs(SCHEMA, { limite: 0 })).toBe("« limite » doit être ≥ 1.");
    expect(validateArgs(SCHEMA, { limite: 2.5 })).toBe("« limite » doit être un nombre entier.");
    expect(validateArgs(SCHEMA, { inclure: "oui" })).toBe("« inclure » doit valoir true ou false.");
    expect(validateArgs(SCHEMA, { projet: 42 })).toBe("« projet » doit être du texte.");
    expect(validateArgs(SCHEMA, { pays: "FR" })).toMatch(/^Argument inconnu : « pays »/);
    expect(validateArgs({ ...SCHEMA, required: ["projet"] }, {})).toBe("Argument requis manquant : « projet ».");
  });
});

describe("handleMcpHttp — l'échange HTTP complet", () => {
  const cle = "jv_bonne";
  const resoudre = async (t: string) => (t === cle ? serveur() : null);
  const post = (body: string, authorization: string | null = `Bearer ${cle}`) =>
    handleMcpHttp({ method: "POST", authorization, body }, resoudre);

  it("sans clé, ou avec une clé inconnue : 401 avec WWW-Authenticate", async () => {
    for (const auth of [null, "Bearer jv_revoquee", "Basic abc"]) {
      const r = await post(JSON.stringify(req(1, "ping")), auth);
      expect(r.status).toBe(401);
      expect(r.headers["WWW-Authenticate"]).toBe('Bearer realm="jarvia"');
    }
  });

  it("le défi du 401 est celui fourni, et sait si un jeton a été présenté", async () => {
    const vus: boolean[] = [];
    const defi = (presente: boolean) => {
      vus.push(presente);
      return presente ? "Bearer error=\"invalid_token\"" : "Bearer resource_metadata=\"x\"";
    };
    const sans = await handleMcpHttp({ method: "POST", authorization: null, body: "{}" }, resoudre, defi);
    const perime = await handleMcpHttp(
      { method: "POST", authorization: "Bearer jvat_expire", body: "{}" },
      resoudre,
      defi,
    );
    expect(sans.headers["WWW-Authenticate"]).toBe('Bearer resource_metadata="x"');
    expect(perime.headers["WWW-Authenticate"]).toBe('Bearer error="invalid_token"');
    expect(vus).toEqual([false, true]);
  });

  it("avec la bonne clé : 200 et la réponse JSON-RPC", async () => {
    const r = await post(JSON.stringify(req(1, "ping")));
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(r.body!)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("notification : 202 sans corps ; JSON cassé : 400 ; autre méthode HTTP : 405", async () => {
    const notif = await post(JSON.stringify(req(undefined, "notifications/initialized")));
    expect(notif).toEqual({ status: 202, headers: {}, body: null });
    const casse = await post("{pas du json");
    expect(casse.status).toBe(400);
    expect(JSON.parse(casse.body!).error.code).toBe(RPC.PARSE_ERROR);
    const get = await handleMcpHttp({ method: "GET", authorization: `Bearer ${cle}`, body: "" }, resoudre);
    expect(get.status).toBe(405);
    expect(get.headers.Allow).toBe("POST");
  });

  it("la clé n'est jamais résolue avant d'avoir vérifié la méthode", async () => {
    let resolutions = 0;
    await handleMcpHttp({ method: "GET", authorization: `Bearer ${cle}`, body: "" }, async () => {
      resolutions += 1;
      return serveur();
    });
    expect(resolutions).toBe(0);
  });
});

describe("bearerToken", () => {
  it("extrait la clé, casse du schéma ignorée", () => {
    expect(bearerToken("Bearer jv_abc")).toBe("jv_abc");
    expect(bearerToken("bearer   jv_abc  ")).toBe("jv_abc");
    expect(bearerToken("Basic jv_abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
  });
});

describe("arguments des outils d'écriture : montants et listes", () => {
  const schema = {
    type: "object" as const,
    properties: {
      montant: { type: "number" as const, description: "m" },
      parts: {
        type: "array" as const,
        description: "p",
        maxItems: 2,
        items: {
          type: "object" as const,
          properties: { montant: { type: "number" as const, description: "m" }, usage: { type: "string" as const, description: "u" } },
          required: ["montant", "usage"],
          additionalProperties: false as const,
        },
      },
      destinations: { type: "array" as const, description: "d", items: { type: "string" as const } },
    },
    required: ["montant"],
    additionalProperties: false as const,
  };

  it("un montant en nombre ou à la française, une liste d'objets conformes", () => {
    expect(validateArgs(schema, { montant: 1806, parts: [{ montant: 832, usage: "business" }] })).toBeNull();
    expect(validateArgs(schema, { montant: "1 337,49", destinations: ["Antho Banque"] })).toBeNull();
  });

  it("le PREMIER problème, avec la position dans la liste", () => {
    expect(validateArgs(schema, { montant: true })).toBe("« montant » doit être un nombre.");
    expect(validateArgs(schema, { montant: 1, parts: "832" })).toBe("« parts » doit être une liste.");
    expect(validateArgs(schema, { montant: 1, parts: [{ montant: 1, usage: "pay" }, { usage: "pay" }] })).toBe(
      "Argument requis manquant : « parts[2].montant ».",
    );
    expect(validateArgs(schema, { montant: 1, parts: [{ montant: 1, usage: "pay", cadeau: 1 }] })).toContain(
      "Argument inconnu : « parts[1].cadeau »",
    );
    expect(validateArgs(schema, { montant: 1, parts: [{}, {}, {}] })).toBe("« parts » : 2 éléments au plus.");
    expect(validateArgs(schema, { montant: 1, destinations: [3] })).toBe("« destinations[1] » doit être du texte.");
  });
});

describe("prompts — flux de travail tout prêts", () => {
  const avecPrompts = (): McpServer => ({
    ...serveur(),
    prompts: promptsJarvia(["missions"], "2026-10-07"),
  });

  it("annoncés à l'initialize seulement quand le serveur en publie", async () => {
    const avec = await handleMcpMessage(avecPrompts(), req(1, "initialize", { protocolVersion: "2025-06-18" }));
    expect(avec).toMatchObject({ result: { capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } } } });
    const sans = await handleMcpMessage(serveur(), req(2, "prompts/list"));
    expect(sans).toMatchObject({ error: { code: RPC.METHOD_NOT_FOUND } });
  });

  it("la liste porte nom, titre, description et arguments", async () => {
    const r = (await handleMcpMessage(avecPrompts(), req(1, "prompts/list"))) as { result: { prompts: { name: string; arguments: { name: string; required?: boolean }[] }[] } };
    expect(r.result.prompts.map((p) => p.name)).toEqual(["point_du_jour", "planifier_semaine", "bilan_du_mois", "labo_hooks", "rejouer_gagnants"]);
    expect(r.result.prompts.find((p) => p.name === "labo_hooks")!.arguments).toContainEqual(expect.objectContaining({ name: "campagne", required: true }));
  });

  it("un prompt rend un message utilisateur avec ses arguments", async () => {
    const r = await handleMcpMessage(avecPrompts(), req(1, "prompts/get", { name: "bilan_du_mois", arguments: { mois: "2026-02", projet: "snytch" } }));
    const texte = (r as { result: { messages: { role: string; content: { text: string } }[] } }).result.messages[0];
    expect(texte.role).toBe("user");
    expect(texte.content.text).toContain("du 2026-02-01 au 2026-02-28");
    expect(texte.content.text).toContain("« snytch »");
  });

  it("prompt inconnu, argument requis manquant, argument illisible : erreurs de paramètres", async () => {
    const inconnu = await handleMcpMessage(avecPrompts(), req(1, "prompts/get", { name: "tout_faire" }));
    expect(inconnu).toMatchObject({ error: { code: RPC.INVALID_PARAMS, message: "Prompt inconnu : tout_faire." } });
    const manquant = await handleMcpMessage(avecPrompts(), req(2, "prompts/get", { name: "labo_hooks", arguments: { campagne: "  " } }));
    expect(manquant).toMatchObject({ error: { code: RPC.INVALID_PARAMS, message: "Argument requis manquant : « campagne »." } });
    const illisible = await handleMcpMessage(avecPrompts(), req(3, "prompts/get", { name: "bilan_du_mois", arguments: { mois: "septembre" } }));
    expect(illisible).toMatchObject({ error: { code: RPC.INVALID_PARAMS, message: "« mois » : AAAA-MM (ex. 2026-09)." } });
    const pasTexte = await handleMcpMessage(avecPrompts(), req(4, "prompts/get", { name: "rejouer_gagnants", arguments: { jours: 30 } }));
    expect(pasTexte).toMatchObject({ error: { code: RPC.INVALID_PARAMS } });
  });
});
