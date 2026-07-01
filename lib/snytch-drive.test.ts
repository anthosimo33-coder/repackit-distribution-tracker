import { describe, it, expect } from "vitest";
import {
  SNYTCH_SLUG,
  isSnytchProject,
  parseServiceAccount,
  driveShortId,
  creatorFolderName,
  classifyDriveKind,
  formatBytes,
} from "./snytch-drive";

// Clé PEM factice (NON secrète) — juste pour vérifier la reconversion des \n.
const FAKE_PEM =
  "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkq\nAAAA==\n-----END PRIVATE KEY-----\n";

function saJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "service_account",
    project_id: "snytch-drive-501108",
    client_email: "sa@snytch-drive-501108.iam.gserviceaccount.com",
    private_key: FAKE_PEM,
    token_uri: "https://oauth2.googleapis.com/token",
    ...overrides,
  });
}

describe("isSnytchProject — gate par slug", () => {
  it("snytch → true ; tout le reste → false", () => {
    expect(SNYTCH_SLUG).toBe("snytch");
    expect(isSnytchProject("snytch")).toBe(true);
    expect(isSnytchProject("repackit")).toBe(false);
    expect(isSnytchProject("")).toBe(false);
    expect(isSnytchProject("Snytch")).toBe(false); // sensible à la casse
  });
});

describe("parseServiceAccount — parsing du JSON service account", () => {
  it("extrait client_email / private_key / token_uri", () => {
    const sa = parseServiceAccount(saJson());
    expect(sa.clientEmail).toBe(
      "sa@snytch-drive-501108.iam.gserviceaccount.com",
    );
    expect(sa.tokenUri).toBe("https://oauth2.googleapis.com/token");
    // Les vrais sauts de ligne du PEM sont préservés.
    expect(sa.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
    expect(sa.privateKey.split("\n").length).toBeGreaterThan(2);
  });

  it("reconvertit les \\n ÉCHAPPÉS de private_key en vrais sauts de ligne", () => {
    // private_key posé avec des backslash-n littéraux (gotcha env var courant).
    const escaped = FAKE_PEM.replace(/\n/g, "\\n");
    expect(escaped).toContain("\\n");
    const sa = parseServiceAccount(saJson({ private_key: escaped }));
    expect(sa.privateKey).not.toContain("\\n");
    expect(sa.privateKey).toContain("\n");
    expect(sa.privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n")).toBe(true);
  });

  it("token_uri par défaut si absent", () => {
    const sa = parseServiceAccount(saJson({ token_uri: undefined }));
    expect(sa.tokenUri).toBe("https://oauth2.googleapis.com/token");
  });

  it("JSON invalide → jette (sans exposer la clé)", () => {
    expect(() => parseServiceAccount("{pas du json")).toThrow(/JSON invalide/);
  });

  it("client_email manquant → jette", () => {
    expect(() => parseServiceAccount(saJson({ client_email: undefined }))).toThrow(
      /client_email/,
    );
  });

  it("private_key manquant → jette, et le message ne contient jamais de clé", () => {
    try {
      parseServiceAccount(saJson({ private_key: "" }));
      throw new Error("aurait dû jeter");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toMatch(/private_key/);
      expect(msg).not.toContain("BEGIN PRIVATE KEY");
    }
  });
});

describe("creatorFolderName — nom du sous-dossier Drive", () => {
  const ID = "k1234567890abcdefghij"; // id Convex factice

  it("« <nom> — <id court> » avec les 6 derniers caractères de l'id", () => {
    expect(driveShortId(ID)).toBe("efghij");
    expect(creatorFolderName("Marielle", ID)).toBe("Marielle — efghij");
  });

  it("réduit les espaces internes et trim", () => {
    expect(creatorFolderName("  Jean   Dupont  ", ID)).toBe(
      "Jean Dupont — efghij",
    );
  });

  it("nom vide → « Créateur »", () => {
    expect(creatorFolderName("   ", ID)).toBe("Créateur — efghij");
    expect(creatorFolderName("", ID)).toBe("Créateur — efghij");
  });

  it("nom très long borné à 60 caractères", () => {
    const long = "a".repeat(120);
    const out = creatorFolderName(long, ID);
    expect(out).toBe(`${"a".repeat(60)} — efghij`);
  });

  it("deux créateurs homonymes → dossiers distincts (id court)", () => {
    expect(creatorFolderName("Marielle", "aaa111")).not.toBe(
      creatorFolderName("Marielle", "bbb222"),
    );
  });
});

describe("classifyDriveKind — vidéo / photo / autre", () => {
  it("par mimeType", () => {
    expect(classifyDriveKind("video/mp4", "x.mp4")).toBe("video");
    expect(classifyDriveKind("video/quicktime", "clip.mov")).toBe("video");
    expect(classifyDriveKind("image/jpeg", "p.jpg")).toBe("photo");
    expect(classifyDriveKind("image/heic", "p.heic")).toBe("photo");
  });

  it("fallback extension quand le mimeType est absent (fichiers iPhone)", () => {
    expect(classifyDriveKind("", "IMG_0001.MOV")).toBe("video");
    expect(classifyDriveKind("", "IMG_0002.HEIC")).toBe("photo");
    expect(classifyDriveKind("application/octet-stream", "a.mp4")).toBe("video");
    expect(classifyDriveKind("application/octet-stream", "a.png")).toBe("photo");
  });

  it("inconnu → other", () => {
    expect(classifyDriveKind("application/pdf", "doc.pdf")).toBe("other");
    expect(classifyDriveKind("", "noextension")).toBe("other");
  });
});

describe("formatBytes", () => {
  it("formatte en o / Ko / Mo / Go (fr)", () => {
    expect(formatBytes(0)).toBe("0 o");
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1024)).toBe("1 Ko");
    expect(formatBytes(1024 * 1024)).toBe("1 Mo");
    expect(formatBytes(Math.round(1.2 * 1024 * 1024 * 1024))).toBe("1,2 Go");
  });

  it("valeurs invalides → 0 o", () => {
    expect(formatBytes(-5)).toBe("0 o");
    expect(formatBytes(NaN)).toBe("0 o");
  });
});
