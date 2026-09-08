import { describe, it, expect } from "vitest";
import {
  publishedStamps,
  summarizeCreatorActivity,
  EMPTY_ACTIVITY,
} from "../convex/creatorActivity";

/**
 * ACTIVITÉ PAR CRÉATRICE — ce que ces tests protègent.
 *
 * Trois façons de faire mentir ces colonnes sans que rien ne casse :
 *
 *   1. compter le legacy `publishedAt` EN PLUS des cibles publiées — les fiches
 *      migrées affichent le double de posts, et personne ne le remarque parce
 *      que le chiffre reste plausible ;
 *   2. prendre le MINIMUM pour « dernier post », par recopie de
 *      `representativePostedAt` qui, lui, a raison de prendre le min — une
 *      créatrice qui publie tous les jours s'affiche muette depuis six semaines ;
 *   3. compter les comptes archivés (donc aussi les comptes REFUSÉS, que
 *      `refuseCompte` archive) — la colonne annonce du travail disparu.
 *
 * Les entrées ont la forme de la prod : identifiants Convex opaques, dates
 * réelles espacées de plusieurs jours (jamais « aujourd'hui »), et une fiche
 * migrée qui porte À LA FOIS le legacy et des cibles.
 */

const KELLY = "k57f2h9c2m4x8p1q0zvb3nde";
const CINTIA = "k9x1m4t7r2s5w8y0adfg6hjk";
const LAURE = "k2p8v5n1q7z4c6b9tyum3wsx";

// Dates espacées, en ms — un « dernier post » qui tombe le jour du test ne
// prouverait rien sur l'ordre.
const D = (iso: string) => Date.parse(iso);
const LUN = D("2026-08-31T09:12:00Z");
const MER = D("2026-09-02T18:40:00Z");
const DIM = D("2026-09-06T21:05:00Z");

describe("publishedStamps", () => {
  it("une cible publiée = un post", () => {
    expect(
      publishedStamps({
        creatorId: KELLY,
        targets: [{ publishedAt: LUN }, { publishedAt: MER }],
      }),
    ).toEqual([LUN, MER]);
  });

  it("des cibles non publiées ne comptent pas", () => {
    expect(
      publishedStamps({
        creatorId: KELLY,
        targets: [{ publishedAt: null }, {}],
      }),
    ).toEqual([]);
  });

  it("le legacy top-level compte SEUL, quand aucune cible n'est publiée", () => {
    expect(publishedStamps({ creatorId: KELLY, publishedAt: LUN })).toEqual([
      LUN,
    ]);
  });

  it("le legacy ne s'AJOUTE pas aux cibles publiées", () => {
    // La fiche migrée : le top-level a survécu à la migration vers `targets`.
    // Les additionner double le compteur de posts sans rien casser d'autre.
    const stamps = publishedStamps({
      creatorId: KELLY,
      publishedAt: LUN,
      targets: [{ publishedAt: MER }],
    });
    expect(stamps).toEqual([MER]);
    expect(stamps).toHaveLength(1);
  });
});

describe("summarizeCreatorActivity", () => {
  it("compte les comptes vivants, jamais les archivés ni ceux de l'équipe", () => {
    const out = summarizeCreatorActivity({
      comptes: [
        { creatorId: KELLY, status: "actif" },
        { creatorId: KELLY, status: "warmup" },
        { creatorId: KELLY, status: "shadowban" },
        // Archivé — y compris le cas d'un compte REFUSÉ à la validation.
        { creatorId: KELLY, status: "archived" },
        // Compte INTERNE (pas de propriétaire) : ne se compte chez personne.
        { creatorId: null, status: "actif" },
        { status: "actif" },
      ],
      assignments: [],
    });
    expect(out.get(KELLY)?.comptes).toBe(3);
    // L'assertion de PRÉSENCE en face de celle d'absence : les comptes sans
    // propriétaire ne créent aucune entrée fantôme.
    expect(out.size).toBe(1);
  });

  it("un compte sans statut est un compte vivant (rows d'avant le champ)", () => {
    // `comptes.status` est optional au schéma : les rows antérieures au champ
    // n'en portent pas. Les traiter comme archivées viderait la colonne.
    const out = summarizeCreatorActivity({
      comptes: [{ creatorId: CINTIA }, { creatorId: CINTIA, status: undefined }],
      assignments: [],
    });
    expect(out.get(CINTIA)?.comptes).toBe(2);
  });

  it("« dernier post » est le MAXIMUM, pas le minimum", () => {
    // Le piège : `representativePostedAt` prend le MIN, et a raison de le faire
    // pour le statut calendrier. Le recopier ici afficherait Kelly muette depuis
    // le 31 août alors qu'elle a publié le 6 septembre.
    const out = summarizeCreatorActivity({
      comptes: [],
      assignments: [
        { creatorId: KELLY, targets: [{ publishedAt: LUN }] },
        { creatorId: KELLY, targets: [{ publishedAt: DIM }] },
        { creatorId: KELLY, targets: [{ publishedAt: MER }] },
      ],
    });
    expect(out.get(KELLY)?.lastPostAt).toBe(DIM);
    expect(out.get(KELLY)?.lastPostAt).not.toBe(LUN);
    expect(out.get(KELLY)?.publications).toBe(3);
  });

  it("deux plateformes sur une même mission = deux posts", () => {
    const out = summarizeCreatorActivity({
      comptes: [],
      assignments: [
        {
          creatorId: CINTIA,
          targets: [{ publishedAt: MER }, { publishedAt: MER }],
        },
      ],
    });
    expect(out.get(CINTIA)?.publications).toBe(2);
  });

  it("une mission assignée mais jamais publiée ne compte pas comme un post", () => {
    const out = summarizeCreatorActivity({
      comptes: [{ creatorId: LAURE, status: "warmup" }],
      assignments: [
        { creatorId: LAURE, targets: [{ publishedAt: null }] },
        { creatorId: LAURE, targets: [] },
        { creatorId: LAURE },
      ],
    });
    expect(out.get(LAURE)?.publications).toBe(0);
    // Et « jamais publié » se distingue de « publié il y a longtemps ».
    expect(out.get(LAURE)?.lastPostAt).toBeNull();
    // Elle existe quand même dans la Map : elle a un compte.
    expect(out.get(LAURE)?.comptes).toBe(1);
  });

  it("une créatrice sans aucune ligne est ABSENTE, pas à zéro", () => {
    // L'appelant décide si ça se rend « 0 » ou « — ». Renvoyer un zéro d'office
    // effacerait la distinction avant qu'il puisse la faire.
    const out = summarizeCreatorActivity({ comptes: [], assignments: [] });
    expect(out.has(KELLY)).toBe(false);
    expect(out.get(KELLY)).toBeUndefined();
    expect(EMPTY_ACTIVITY).toEqual({
      comptes: 0,
      publications: 0,
      lastPostAt: null,
    });
  });

  it("chaque créatrice a sa propre ligne — aucune fuite entre fiches", () => {
    const out = summarizeCreatorActivity({
      comptes: [
        { creatorId: KELLY, status: "actif" },
        { creatorId: CINTIA, status: "actif" },
        { creatorId: CINTIA, status: "warmup" },
      ],
      assignments: [
        { creatorId: KELLY, targets: [{ publishedAt: DIM }] },
        { creatorId: CINTIA, targets: [{ publishedAt: LUN }] },
      ],
    });
    expect(out.get(KELLY)).toEqual({
      comptes: 1,
      publications: 1,
      lastPostAt: DIM,
    });
    expect(out.get(CINTIA)).toEqual({
      comptes: 2,
      publications: 1,
      lastPostAt: LUN,
    });
  });
});
