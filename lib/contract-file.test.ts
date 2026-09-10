import { describe, it, expect } from "vitest";
import {
  CONTRACT_CONTENT_TYPE,
  CONTRACT_MAX_BYTES,
  resolveContractContentType,
  validateContractFile,
} from "./contract-file";

describe("resolveContractContentType", () => {
  it("garde le MIME quand le navigateur l'a renseigné", () => {
    expect(
      resolveContractContentType({
        type: "application/pdf",
        name: "Contrat Juliette Chetrit - Snytch.pdf",
      }),
    ).toBe(CONTRACT_CONTENT_TYPE);
  });

  it("retombe sur l'extension quand le MIME est vide (certains OS)", () => {
    expect(
      resolveContractContentType({
        type: "",
        name: "Contrat Juliette Chetrit - Snytch.PDF",
      }),
    ).toBe(CONTRACT_CONTENT_TYPE);
  });

  it("refuse un fichier qui n'est un PDF ni par le MIME ni par le nom", () => {
    expect(
      resolveContractContentType({
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        name: "Contrat Juliette Chetrit.docx",
      }),
    ).toBeNull();
    // Le nom contient « pdf » sans être l'extension — piège classique.
    expect(
      resolveContractContentType({ type: "image/png", name: "scan-pdf.png" }),
    ).toBeNull();
  });
});

describe("validateContractFile", () => {
  it("accepte un PDF de taille plausible (contrat scanné, 1,4 Mo)", () => {
    expect(
      validateContractFile({
        contentType: CONTRACT_CONTENT_TYPE,
        size: 1_432_118,
      }),
    ).toEqual({ ok: true });
  });

  it("refuse tout ce qui n'est pas un PDF", () => {
    for (const t of ["image/png", "video/mp4", "text/plain", ""]) {
      const r = validateContractFile({ contentType: t, size: 1_432_118 });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("PDF");
    }
  });

  it("refuse un fichier vide ou de taille absurde", () => {
    for (const size of [0, -1, Number.NaN]) {
      expect(
        validateContractFile({ contentType: CONTRACT_CONTENT_TYPE, size }).ok,
      ).toBe(false);
    }
  });

  it("accepte exactement 20 Mo et refuse un octet de plus", () => {
    expect(
      validateContractFile({
        contentType: CONTRACT_CONTENT_TYPE,
        size: CONTRACT_MAX_BYTES,
      }).ok,
    ).toBe(true);
    const r = validateContractFile({
      contentType: CONTRACT_CONTENT_TYPE,
      size: CONTRACT_MAX_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("20 Mo");
  });
});
