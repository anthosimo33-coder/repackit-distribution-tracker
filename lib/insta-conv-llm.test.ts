import { describe, expect, it } from "vitest";
import {
  bytesToDataUrl,
  extractTikTokMedia,
  isTikTokCdnUrl,
  isTikTokPostUrl,
  parseResponsesOutput,
  readingRequest,
  rewriteRequest,
  sanitizeItems,
  sanitizeReading,
} from "./insta-conv-llm";

/** Forme utile d'un corps de requête, pour lire ses champs sans `any`. */
type RequestBody = {
  model: string;
  input: Array<{ content: Array<Record<string, unknown> & { text?: string }> }>;
  text: {
    format: Record<string, unknown> & {
      schema: { additionalProperties: boolean; properties: { items: { items: { required: string[] } } } };
    };
  };
};

/** Réponse `/v1/responses` telle que l'API la rend (sans le raccourci `output_text` des SDK). */
const response = (text: string, extra: object = {}) => ({
  id: "resp_1",
  object: "response",
  status: "completed",
  output: [
    { type: "reasoning", id: "rs_1", summary: [] },
    { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] },
  ],
  ...extra,
});

describe("requêtes OpenAI", () => {
  it("la lecture envoie l'image en haute définition et exige le schéma strict", () => {
    const body = readingRequest("gpt-5", "data:image/jpeg;base64,AAAA") as unknown as RequestBody;
    expect(body.model).toBe("gpt-5");
    expect(body.input[0].content[1]).toEqual({ type: "input_image", image_url: "data:image/jpeg;base64,AAAA", detail: "high" });
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true, name: "instagram_dm_reading" });
    // Mode strict : chaque objet ferme ses propriétés et les exige toutes.
    expect(body.text.format.schema.additionalProperties).toBe(false);
    expect(body.text.format.schema.properties.items.items.required).toEqual(["kind", "side", "text", "edited", "reaction"]);
  });

  it("la réécriture numérote les éléments pour que « le message 3 » ait un sens", () => {
    const body = rewriteRequest("gpt-5", "remplace le 2", {
      locale: "fr",
      contactName: "Lucas",
      items: [
        { kind: "message", side: "out", text: "salut", edited: false, reaction: null },
        { kind: "message", side: "in", text: "yo", edited: false, reaction: null },
      ],
    }) as unknown as RequestBody;
    const text = body.input[0].content[0].text ?? "";
    expect(text).toContain('"index":2');
    expect(text).toContain("remplace le 2");
    expect(text).toContain("contact: Lucas");
  });
});

describe("parseResponsesOutput", () => {
  it("lit le JSON du message, en ignorant le bloc de raisonnement", () => {
    expect(parseResponsesOutput(response('{"items":[]}'))).toEqual({ ok: true, json: { items: [] } });
  });

  it("remonte une erreur d'API avec son message", () => {
    const out = parseResponsesOutput({ error: { message: "Incorrect API key provided", type: "invalid_request_error" } });
    expect(out).toEqual({ ok: false, reason: "Incorrect API key provided" });
  });

  it("distingue refus, réponse tronquée et JSON cassé", () => {
    const refusal = {
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Je ne peux pas" }] }],
    };
    expect(parseResponsesOutput(refusal)).toMatchObject({ ok: false, reason: expect.stringContaining("refus") });
    expect(parseResponsesOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).toEqual({
      ok: false,
      reason: "réponse incomplète (max_output_tokens)",
    });
    expect(parseResponsesOutput(response("{pas du json"))).toEqual({ ok: false, reason: "JSON illisible" });
    expect(parseResponsesOutput(null)).toEqual({ ok: false, reason: "aucun texte dans la réponse" });
  });
});

describe("garde-fous à l'arrivée", () => {
  it("écarte les messages vides ou sans côté, borne la réaction, normalise les dates", () => {
    expect(
      sanitizeItems([
        { kind: "message", side: "out", text: "  salut  ", edited: true, reaction: "😂😂😂😂😂😂" },
        { kind: "message", side: "none", text: "sans côté" },
        { kind: "message", side: "in", text: "   " },
        { kind: "date", side: "in", text: "25 AUG AT 22:14", edited: true, reaction: "❤️" },
        "n'importe quoi",
      ]),
    ).toEqual([
      { kind: "message", side: "out", text: "salut", edited: true, reaction: "😂😂😂😂" },
      { kind: "date", side: "none", text: "25 AUG AT 22:14", edited: false, reaction: null },
    ]);
  });

  it("borne la lecture d'une capture (batterie, barres, @ du pseudo)", () => {
    const r = sanitizeReading({
      theme: "neon",
      locale: "en",
      contact: { name: "Kevin Pinto", username: "@kevinp7_" },
      status: { time: "11:52", battery: 144, lowPower: true, signal: 9 },
      items: [{ kind: "message", side: "in", text: "il dois y avoir une part de chance Oui", edited: false, reaction: null }],
    });
    expect(r).toEqual({
      theme: "dark",
      locale: "en",
      contact: { name: "Kevin Pinto", username: "kevinp7_" },
      status: { time: "11:52", battery: 100, lowPower: true, signal: 4 },
      items: [{ kind: "message", side: "in", text: "il dois y avoir une part de chance Oui", edited: false, reaction: null }],
    });
  });
});

describe("TikTok", () => {
  const page = (itemStruct: object, statusCode = 0) =>
    `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode, statusMsg: "", itemInfo: { itemStruct } } },
    })}</script></html>`;
  const cdn = (n: string) => `https://p16-sign-va.tiktokcdn.com/obj/${n}`;

  it("carrousel photo : une image par photo, le JPEG préféré au webp", () => {
    const html = page({
      id: "1",
      imagePost: {
        images: [
          { imageURL: { urlList: [cdn("a.webp"), cdn("a.jpeg")] } },
          { imageURL: { urlList: [cdn("b.webp")] } },
        ],
      },
      video: { cover: cdn("cover.jpeg") },
    });
    expect(extractTikTokMedia(html)).toEqual({ kind: "photos", images: [cdn("a.jpeg"), cdn("b.webp")] });
  });

  it("vidéo : la couverture d'origine, seule image sans décoder la vidéo", () => {
    const html = page({ id: "2", video: { cover: cdn("c.jpeg"), originCover: cdn("o.jpeg") } });
    expect(extractTikTokMedia(html)).toEqual({ kind: "video", images: [cdn("o.jpeg")] });
  });

  it("refus de TikTok, page sans payload, hôtes hors CDN", () => {
    expect(extractTikTokMedia(page({ id: "3" }, 10204))).toMatchObject({ kind: "unreadable" });
    expect(extractTikTokMedia("<html></html>")).toMatchObject({ kind: "unreadable" });
    const html = page({ id: "4", video: { originCover: "https://evil.example.com/x.jpeg" } });
    expect(extractTikTokMedia(html)).toMatchObject({ kind: "unreadable" });
  });

  it("valide les liens de post et les hôtes d'image", () => {
    expect(isTikTokPostUrl("https://www.tiktok.com/@a/photo/123?_r=1")).toBe(true);
    expect(isTikTokPostUrl("https://vm.tiktok.com/ZNabc/")).toBe(true);
    expect(isTikTokPostUrl("https://tiktok.com.evil.io/@a")).toBe(false);
    expect(isTikTokPostUrl("http://www.tiktok.com/@a")).toBe(false);
    expect(isTikTokCdnUrl("https://p16-common-sign.tiktokcdn-eu.com/tos/x.jpeg")).toBe(true);
    expect(isTikTokCdnUrl("https://p16-sign-va.tiktokcdn.com/obj/x")).toBe(true);
    expect(isTikTokCdnUrl("https://tiktokcdn.com.evil.io/x")).toBe(false);
  });

  it("encode des octets en data URL", () => {
    expect(bytesToDataUrl(new Uint8Array([104, 105]), "image/png")).toBe("data:image/png;base64,aGk=");
  });
});
