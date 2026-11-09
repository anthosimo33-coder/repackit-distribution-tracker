/**
 * Boucles MULTI-PROJETS des crons de notification (digest du matin, bilan du
 * soir), extraites de convex/notifications.ts pour être testées sans Convex ni
 * Telegram : chaque boucle reçoit ses dépendances (lectures, composition du
 * message, envoi), les actions de notifications.ts ne font que les câbler.
 *
 * ISOLEMENT PAR PROJET. Du 04 au 08/11/2026, le digest de Snytch a levé une
 * exception (limite des 32 000 lectures de `collectDigest`, corrigée par #464) ;
 * la boucle n'était pas protégée, et BLUSH, qui suit Snytch dans l'ordre de
 * création, n'a plus reçu le sien. Désormais un projet qui tombe est journalisé
 * avec son slug, les suivants passent, puis la boucle JETTE en listant les
 * projets tombés : le cron reste rouge (dashboard Convex, `convex insights`)
 * au lieu de réussir en silence avec un projet en moins.
 *
 * Module PUR (aucun import `_generated`), testé par
 * lib/notify-project-loop.test.ts.
 */

/** Un projet candidat : son identifiant, et son slug pour les journaux. */
export type NotifyProjectRef<I> = { projectId: I; slug: string };

export type SendOutcome = { ok: boolean };

export type ProjectFailure = { slug: string; error: string };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Exécute `step` pour chaque projet, dans l'ordre, sans qu'une exception d'un
 * projet n'interrompe les suivants. Rend les projets tombés ; ne jette pas.
 */
export async function forEachProjectIsolated<I>(
  job: string,
  projects: readonly NotifyProjectRef<I>[],
  step: (project: NotifyProjectRef<I>) => Promise<void>,
): Promise<ProjectFailure[]> {
  const failures: ProjectFailure[] = [];
  for (const project of projects) {
    try {
      await step(project);
    } catch (e) {
      const error = errorText(e);
      console.error(
        `[notifications] ${job} : projet « ${project.slug} » en échec, ` +
          `on passe au suivant — ${error}`,
      );
      failures.push({ slug: project.slug, error });
    }
  }
  return failures;
}

/**
 * Fait échouer le cron APRÈS la boucle si un projet est tombé, en les listant.
 * Le résumé est recopié dans le message : l'action qui jette ne rend rien.
 */
export function throwIfProjectsFailed(
  job: string,
  failures: readonly ProjectFailure[],
  summary: { projects: number; sent: number; silent: number },
): void {
  if (failures.length === 0) return;
  const list = failures.map((f) => `${f.slug} (${f.error})`).join(" ; ");
  throw new Error(
    `[notifications] ${job} : ${failures.length} projet(s) en échec — ${list}. ` +
      `Les autres projets ont été traités (envoyés : ${summary.sent}, ` +
      `sans rien à signaler : ${summary.silent}, projets : ${summary.projects}).`,
  );
}

export type DigestSummary = {
  projects: number;
  sent: number;
  silent: number;
};

export type EveningSummary = {
  /** Projets dont l'heure de bilan correspond à MAINTENANT (Paris). */
  projects: number;
  /** Messages envoyés (un par créatrice concernée). */
  sent: number;
  /** Projets à l'heure du bilan mais sans rien à signaler. */
  silent: number;
};

export type DigestLoopDeps<I, Cfg, Data> = {
  listProjects: () => Promise<NotifyProjectRef<I>[]>;
  /** null : projet introuvable, on passe. */
  collect: (projectId: I) => Promise<Data | null>;
  /** null : canal non configuré pour ce projet, on passe. */
  channel: (projectId: I) => Promise<Cfg | null>;
  /** null : rien à signaler, aucun message. */
  compose: (data: Data, cfg: Cfg) => string | null;
  send: (cfg: Cfg, text: string) => Promise<SendOutcome>;
};

/** Le digest quotidien : UN message par projet configuré, aucun s'il n'y a rien à dire. */
export async function runDigestLoop<I, Cfg, Data>(
  deps: DigestLoopDeps<I, Cfg, Data>,
): Promise<DigestSummary> {
  const projects = await deps.listProjects();
  let sent = 0;
  let silent = 0;
  const failures = await forEachProjectIsolated(
    "digest quotidien",
    projects,
    async ({ projectId }) => {
      const data = await deps.collect(projectId);
      if (data === null) return;
      const cfg = await deps.channel(projectId);
      if (cfg === null) return;
      const text = deps.compose(data, cfg);
      if (text === null) {
        silent += 1;
        return;
      }
      const res = await deps.send(cfg, text);
      if (res.ok) sent += 1;
    },
  );
  const summary = { projects: projects.length, sent, silent };
  throwIfProjectsFailed("digest quotidien", failures, summary);
  return summary;
}

export type EveningLoopDeps<I, Ctx, Report> = {
  listProjects: () => Promise<NotifyProjectRef<I>[]>;
  /** Heure de bilan voulue par le projet, en heure de Paris. */
  eveningHour: (projectId: I) => Promise<number>;
  /** null : canal non configuré ou événement éteint, on passe. */
  channel: (projectId: I) => Promise<Ctx | null>;
  /** null : projet introuvable. [] : tout est publié. */
  collect: (projectId: I) => Promise<Report[] | null>;
  /** null : rien à envoyer pour cette créatrice. */
  compose: (report: Report, ctx: Ctx) => string | null;
  send: (ctx: Ctx, text: string) => Promise<SendOutcome>;
};

/**
 * Le bilan de fin de journée : seuls les projets dont l'heure voulue vaut
 * `heureParis` tirent, un message par créatrice qui a encore un post à publier.
 */
export async function runEveningLoop<I, Ctx, Report>(
  heureParis: number,
  deps: EveningLoopDeps<I, Ctx, Report>,
): Promise<EveningSummary> {
  const candidates = await deps.listProjects();
  let projects = 0;
  let sent = 0;
  let silent = 0;
  const failures = await forEachProjectIsolated(
    "bilan de fin de journée",
    candidates,
    async ({ projectId }) => {
      if ((await deps.eveningHour(projectId)) !== heureParis) return;
      projects += 1;
      const ctx = await deps.channel(projectId);
      if (ctx === null) return;
      const reports = await deps.collect(projectId);
      if (reports === null || reports.length === 0) {
        silent += 1;
        return;
      }
      for (const report of reports) {
        const text = deps.compose(report, ctx);
        if (text === null) continue;
        const res = await deps.send(ctx, text);
        if (res.ok) sent += 1;
      }
    },
  );
  const summary = { projects, sent, silent };
  throwIfProjectsFailed("bilan de fin de journée", failures, summary);
  return summary;
}
