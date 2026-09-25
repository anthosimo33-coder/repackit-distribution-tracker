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
