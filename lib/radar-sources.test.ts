import { describe, expect, it } from "vitest";
import { adRunDays, igFollowers, parseIgReel, parseMetaAd, parseTikTokAd, transcriptText } from "../convex/radarSourcesMath";
import { formatStarting, hookTemplate, igHandleFromBio } from "../convex/radarNetworkMath";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 7, 1, 0);

/** Réponses réelles du 07/11/2026 (ScrapeCreators), réduites aux champs lus. */
const TT_AD = {"id": "1878940054907010", "name": "rena8553", "first_shown_date": 1791849600000, "last_shown_date": 1791849600000, "estimated_audience": "0-1K", "url": "https://library.tiktok.com/ads/detail/?ad_id=1878940054907010", "videos": [{"video_url": "https://library.tiktok.com/api/v1/cdn/x/video/y", "cover_img": "https://p16-sign.tiktokcdn.com/cover.jpeg"}]};
const META_AD = {"ad_archive_id": "4470495263178994", "page_name": "Smoothspeak: Texting Rizz App", "is_active": true, "start_date": 1770278400, "end_date": 1793952000, "collation_count": 2, "publisher_platform": ["FACEBOOK", "INSTAGRAM", "THREADS"], "url": "https://www.facebook.com/ads/library?id=4470495263178994", "snapshot": {"page_name": "Smoothspeak: Texting Rizz App", "body": {"text": "Get rizz in your keyboard. Don’t get left on read and join 100,000+ users already loving Smoothspeak!"}, "title": null, "link_description": null, "videos": [{"video_hd_url": "https://video.xx.fbcdn.net/v.mp4", "video_preview_image_url": "https://scontent.xx.fbcdn.net/p.jpg"}], "images": []}};
const IG_REEL = {"media": {"code": "DfYCWtwI2IX", "taken_at": 1793915478, "play_count": 10905, "ig_play_count": 10905, "like_count": 76, "comment_count": 0, "video_duration": 30.509000778198242, "clips_metadata": {"reusable_text_attribute_string": null}, "image_versions2": {"candidates": [{"url": "https://scontent.cdninstagram.com/c.jpg"}]}}};
const TRANSCRIPT = {"transcript": "WEBVTT\n\n\n00:00:00.000 --> 00:00:01.160\no que você tá comendo\n\n00:00:01.760 --> 00:00:02.920\nhum comendo não\n", "transcript_with_timestamp": [{"start": 0, "end": 1.16, "text": "o que você tá comendo"}, {"start": 1.76, "end": 2.92, "text": "hum comendo não"}, {"start": 2.92, "end": 3.76, "text": "tomando um sorvete"}]};

describe("pubs", () => {
  it("TikTok : dates en millisecondes, active si vue ces 2 derniers jours, vidéo et audience", () => {
    const a = parseTikTokAd(TT_AD, NOW)!;
    expect(a).toMatchObject({ platform: "tiktok", adId: "1878940054907010", advertiser: "rena8553", firstShownAt: 1791849600000, audience: "0-1K", active: false });
    expect(a.videoUrl).toContain("library.tiktok.com");
    expect(parseTikTokAd(TT_AD, 1791849600000 + DAY)!.active).toBe(true);
  });

  it("Meta : dates en secondes, texte de la pub, variantes, plateformes, aperçu", () => {
    const a = parseMetaAd(META_AD)!;
    expect(a).toMatchObject({
      platform: "meta",
      adId: "4470495263178994",
      advertiser: "Smoothspeak: Texting Rizz App",
      firstShownAt: 1770278400 * 1000,
      lastShownAt: 1793952000 * 1000,
      active: true,
      variants: 2,
      platforms: ["facebook", "instagram", "threads"],
      coverUrl: "https://scontent.xx.fbcdn.net/p.jpg",
    });
    expect(a.text).toMatch(/^Get rizz in your keyboard/);
  });

  it("jours de diffusion : jusqu'à aujourd'hui si active, sinon jusqu'à la dernière apparition", () => {
    const meta = parseMetaAd(META_AD)!;
    expect(adRunDays(meta, NOW)).toBe(Math.round((NOW - meta.firstShownAt!) / DAY) + 1);
    expect(adRunDays({ ...meta, active: false }, NOW)).toBe(275);
    expect(adRunDays(parseTikTokAd(TT_AD, NOW)!, NOW)).toBe(1);
    expect(adRunDays({ active: true }, NOW)).toBeNull();
  });
});

describe("Instagram", () => {
  it("un Reel : vues, date, lien ; pas de hook quand il n'y a pas de texte incrusté", () => {
    expect(parseIgReel(IG_REEL)).toEqual({
      code: "DfYCWtwI2IX",
      url: "https://www.instagram.com/reel/DfYCWtwI2IX/",
      publishedAt: 1793915478 * 1000,
      views: 10905,
      likes: 76,
      comments: 0,
      durationSec: 30.5,
      coverUrl: "https://scontent.cdninstagram.com/c.jpg",
    });
    const withHook = { media: { ...IG_REEL.media, clips_metadata: { reusable_text_attribute_string: "Quand ton mec\n te dit ça" } } };
    expect(parseIgReel(withHook)!.hook).toBe("Quand ton mec te dit ça");
  });

  it("les abonnés du profil", () => {
    expect(igFollowers({ data: { user: { edge_followed_by: { count: 1212 } } } })).toBe(1212);
    expect(igFollowers({ data: {} })).toBeUndefined();
  });

  it("l'Instagram d'une bio TikTok réelle, et pas le compte principal", () => {
    expect(igHandleFromBio("Creadora UGC Ig:Dakotasecretaccount Shady, sabe cosas 👀")).toBe("dakotasecretaccount");
    expect(igHandleFromBio("Ojo que te stalkeo con Shady 👀  Ig: charlottebarry_8")).toBe("charlottebarry_8");
    expect(igHandleFromBio("Rotina, lifestyle & beleza🎀✨ IG: @rillary_tuanny_ Embaixadora")).toBe("rillary_tuanny_");
    expect(igHandleFromBio("INSTA:@genesiseli_06💗 LINK DE DESCARGA")).toBe("genesiseli_06");
    expect(igHandleFromBio("tout est ici instagram.com/lea.ugc/")).toBe("lea.ugc");
    expect(igHandleFromBio("Stalkear es mi pasión  Usen theick.io main: @Eneas")).toBeNull();
    expect(igHandleFromBio("Embaixador Stalkie 🔗creators.stalkie.io")).toBeNull();
    // « ig » au milieu d'un mot (« digital ») n'est pas un Instagram.
    expect(igHandleFromBio("Creadora de contenido digital 💜 reviews")).toBeNull();
    expect(igHandleFromBio(undefined)).toBeNull();
  });
});

describe("transcriptions", () => {
  it("les segments bout à bout ; le WebVTT sans horodatage s'ils manquent ; rien → null", () => {
    expect(transcriptText(TRANSCRIPT)).toBe("o que você tá comendo hum comendo não tomando um sorvete");
    expect(transcriptText({ transcript: TRANSCRIPT.transcript, transcript_with_timestamp: null })).toBe("o que você tá comendo hum comendo não");
    expect(transcriptText({ transcript: "WEBVTT\n\n", transcript_with_timestamp: [] })).toBeNull();
  });
});

describe("gabarits de hook et formats qui démarrent", () => {
  it("les variantes d'une famille partagent un gabarit ; deux familles non", () => {
    expect(hookTemplate("Quand ton mec te dit qu'il est chez sa mère")).toBe(hookTemplate("QUAND ton mec te demande ton code 😭"));
    expect(hookTemplate("POV : tu découvres qui il suit")).toBe(hookTemplate("pov: tu découvres qui il suivait en secret"));
    expect(hookTemplate("Quand ton mec te dit X")).not.toBe(hookTemplate("Bizarre depuis 3 jours il ne répond plus"));
    // Les chiffres ne séparent pas deux variantes.
    expect(hookTemplate("Jour 3 de mon test")).toBe(hookTemplate("Jour 12 de mon test"));
    expect(hookTemplate("Oi 👋")).toBeNull();
  });

  it("un format démarre quand 3 comptes l'ont publié dans les dernières 48 h", () => {
    const m = (accountId: string, ageH: number) => ({ accountId, publishedAt: NOW - ageH * 3_600_000 });
    expect(formatStarting([m("a", 2), m("b", 20), m("c", 47)], NOW)).toBe(true);
    expect(formatStarting([m("a", 2), m("b", 20), m("c", 49)], NOW)).toBe(false);
    // Le même compte deux fois ne compte qu'une.
    expect(formatStarting([m("a", 2), m("a", 5), m("b", 20)], NOW)).toBe(false);
  });
});
