import { afterEach, describe, expect, it, vi } from "vitest";
// Module SERVEUR pur (aucun import `_generated`).
import {
  runDigestLoop,
  runEveningLoop,
  type NotifyProjectRef,
} from "../convex/notifyProjectLoop";

/**
 * Du 04 au 08/11/2026, le digest de Snytch a levé une exception (limite des
 * 32 000 lectures de `collectDigest`). La boucle n'était pas protégée : BLUSH,
 * qui suit Snytch dans l'ordre de création, n'a plus reçu son digest non plus.
 *
 * Attendu : un projet qui tombe est journalisé avec son slug, les suivants
 * reçoivent leur message, puis la boucle échoue en listant les projets tombés,
 * pour que le cron reste rouge (dashboard Convex, `convex insights`).
 */

const READ_LIMIT =
  "Too many reads in a single function execution (limit: 32000).";

/** Ordre de prod : `listNotifyProjects` rend Snytch avant BLUSH. */
const PROJECTS: NotifyProjectRef<string>[] = [
  { projectId: "p_snytch", slug: "snytch" },
  { projectId: "p_blush", slug: "blush" },
];

type Cfg = { chat: string };

function digestDeps(failing: Set<string>) {
  const sent: string[] = [];
  return {
    sent,
    deps: {
      listProjects: async () => PROJECTS,
      collect: async (projectId: string) => {
        if (failing.has(projectId)) throw new Error(READ_LIMIT);
        return { projectId };
      },
      channel: async (projectId: string): Promise<Cfg> => ({ chat: projectId }),
      compose: (data: { projectId: string }) => `digest de ${data.projectId}`,
      send: async (_cfg: Cfg, text: string) => {
        sent.push(text);
        return { ok: true };
      },
    },
  };
}

function eveningDeps(failing: Set<string>, hours: Record<string, number> = {}) {
  const sent: string[] = [];
  return {
    sent,
    deps: {
      listProjects: async () => PROJECTS,
      eveningHour: async (projectId: string) => hours[projectId] ?? 21,
      channel: async (projectId: string): Promise<Cfg> => ({ chat: projectId }),
      collect: async (projectId: string) => {
        if (failing.has(projectId)) throw new Error(READ_LIMIT);
        return [`${projectId}/juliette`];
      },
      compose: (report: string) => `bilan ${report}`,
      send: async (_cfg: Cfg, text: string) => {
        sent.push(text);
        return { ok: true };
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDigestLoop — un projet qui tombe ne prive pas les suivants", () => {
  it("cas nominal : un digest par projet, aucune erreur", async () => {
    const { sent, deps } = digestDeps(new Set());
    await expect(runDigestLoop(deps)).resolves.toEqual({
      projects: 2,
      sent: 2,
      silent: 0,
    });
    expect(sent).toEqual(["digest de p_snytch", "digest de p_blush"]);
  });

  it("Snytch dépasse la limite de lectures : BLUSH reçoit quand même son digest", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sent, deps } = digestDeps(new Set(["p_snytch"]));

    const run = runDigestLoop(deps);
    await expect(run).rejects.toThrow(/snytch/);

    expect(sent).toEqual(["digest de p_blush"]);
    // Journalisé avec le slug ET la cause.
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(/snytch.*Too many reads/),
    );
  });

  it("l'erreur finale liste les projets tombés, et seulement eux", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = digestDeps(new Set(["p_snytch"]));
    const err = await runDigestLoop(deps).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("snytch");
    expect(message).toContain("Too many reads");
    expect(message).not.toContain("blush");
  });

  it("le dernier projet qui tombe fait aussi échouer le cron (après l'envoi des autres)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sent, deps } = digestDeps(new Set(["p_blush"]));
    await expect(runDigestLoop(deps)).rejects.toThrow(/blush/);
    expect(sent).toEqual(["digest de p_snytch"]);
  });

  it("deux projets tombés : les deux sont listés", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sent, deps } = digestDeps(new Set(["p_snytch", "p_blush"]));
    await expect(runDigestLoop(deps)).rejects.toThrow(/snytch[\s\S]*blush/);
    expect(sent).toEqual([]);
  });
});

describe("runEveningLoop — même isolement pour le bilan du soir", () => {
  it("cas nominal : un bilan par créatrice des projets à l'heure", async () => {
    const { sent, deps } = eveningDeps(new Set());
    await expect(runEveningLoop(21, deps)).resolves.toEqual({
      projects: 2,
      sent: 2,
      silent: 0,
    });
    expect(sent).toEqual(["bilan p_snytch/juliette", "bilan p_blush/juliette"]);
  });

  it("Snytch tombe à 21 h : BLUSH reçoit son bilan, le cron échoue en nommant Snytch", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sent, deps } = eveningDeps(new Set(["p_snytch"]));

    const err = await runEveningLoop(21, deps).then(
      () => null,
      (e: unknown) => e,
    );

    expect(sent).toEqual(["bilan p_blush/juliette"]);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("snytch");
    expect((err as Error).message).not.toContain("blush");
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(/snytch.*Too many reads/),
    );
  });

  it("un projet dont ce n'est pas l'heure n'est pas lu, donc ne peut pas tomber", async () => {
    const { sent, deps } = eveningDeps(new Set(["p_snytch"]), { p_snytch: 20 });
    await expect(runEveningLoop(21, deps)).resolves.toEqual({
      projects: 1,
      sent: 1,
      silent: 0,
    });
    expect(sent).toEqual(["bilan p_blush/juliette"]);
  });
});
