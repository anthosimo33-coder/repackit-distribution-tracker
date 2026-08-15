"use client";

import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  useProjectAction,
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  NOTIFICATION_EVENTS,
  type NotificationEventKey,
  type NotificationEventKind,
} from "@/lib/notification-events";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  SendIcon,
} from "lucide-react";

/**
 * Écran de configuration des notifications hors-app (Telegram), PAR PROJET.
 *
 * Tout ce qui est réglable ici l'est SANS redéploiement — c'est l'exigence du
 * chantier : changer le destinataire ou éteindre un événement est un geste
 * admin, pas une livraison.
 *
 * Le JETON du bot ne se règle PAS ici (et ne s'affiche jamais) : il vit en
 * variable d'environnement Convex. L'écran se contente de dire s'il est présent
 * sur ce déploiement, et rappelle la commande pour le poser.
 */

const SECTIONS: { kind: NotificationEventKind; title: string; blurb: string }[] =
  [
    {
      kind: "immediate",
      title: "Notifications immédiates",
      blurb:
        "Envoyées dès la détection. Plusieurs soumissions rapprochées sont regroupées en un seul message.",
    },
    {
      kind: "digest",
      title: "Digest quotidien",
      blurb:
        "Un seul message par jour, le matin — et aucun message s'il n'y a rien à signaler.",
    },
    {
      kind: "scheduled",
      title: "Bilan de fin de journée",
      blurb:
        "Envoyé à l'heure choisie ci-dessous, en heure de Paris. Un message par créatrice concernée, et rien du tout si tout est publié.",
    },
  ];

type Settings = NonNullable<
  ReturnType<typeof useProjectQuery<typeof api.notifications.getNotifySettings>>
>;

export function NotificationSettings() {
  const settings = useProjectQuery(api.notifications.getNotifySettings, {});

  if (settings === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  // Le formulaire n'est monté qu'UNE fois la config chargée : son état part des
  // valeurs serveur à l'initialisation, sans effet de synchronisation. Sans ce
  // découpage, la réactivité Convex réécrirait la saisie en cours à chaque
  // invalidation (et setState dans un effet est proscrit ici).
  return <SettingsForm settings={settings} />;
}

function SettingsForm({ settings }: { settings: Settings }) {
  const save = useProjectMutation(api.notifications.setNotifySettings);
  const sendTest = useProjectAction(api.notifications.sendTestNotification);

  const [chatId, setChatId] = useState(settings.chatId);
  const [enabled, setEnabled] = useState<Set<NotificationEventKey>>(
    () => new Set(settings.enabledEvents as NotificationEventKey[]),
  );
  const [eveningHour, setEveningHour] = useState(settings.eveningHourParis);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Comparé à la version SERVEUR, qui se rafraîchit après enregistrement → le
  // bouton retombe inactif tout seul, sans recopier l'état à la main.
  const dirty = useMemo(() => {
    if (chatId.trim() !== settings.chatId) return true;
    if (eveningHour !== settings.eveningHourParis) return true;
    const saved = new Set(settings.enabledEvents);
    if (saved.size !== enabled.size) return true;
    for (const k of enabled) if (!saved.has(k)) return true;
    return false;
  }, [settings, chatId, enabled, eveningHour]);

  const channelReady =
    settings.tokenPresent &&
    settings.appBaseUrlPresent &&
    chatId.trim().length > 0;

  function toggle(key: NotificationEventKey, on: boolean) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await save({
        chatId,
        enabledEvents: [...enabled],
        eveningHourParis: eveningHour,
      });
      toast.success(
        res.cleared
          ? "Canal désactivé (destinataire vidé)."
          : "Configuration enregistrée.",
      );
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await sendTest({});
      if (res.ok) toast.success("Message de test envoyé — vérifie Telegram.");
      else toast.error(res.error ?? "Envoi impossible.");
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── État du canal : ce qui manque, et la commande pour le poser ───── */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                État du canal
              </h2>
              {channelReady ? (
                <Badge className="gap-1" variant="secondary">
                  <CheckCircle2Icon className="size-3" /> Prêt
                </Badge>
              ) : (
                <Badge className="gap-1" variant="outline">
                  <AlertTriangleIcon className="size-3" /> Incomplet
                </Badge>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing || !channelReady || dirty}
            >
              {testing ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SendIcon className="size-4" />
              )}
              Envoyer un test
            </Button>
          </div>

          {!settings.tokenPresent && (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
              Le jeton du bot est absent de ce déploiement (variable{" "}
              <code className="font-mono">{settings.tokenEnvVar}</code>). Il ne
              se règle pas ici — pose-le en variable d&apos;environnement :
              <br />
              <code className="mt-1 block font-mono break-all">
                {settings.envHint}
              </code>
            </p>
          )}
          {!settings.appBaseUrlPresent && (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
              <code className="font-mono">APP_BASE_URL</code> est absente : sans
              elle les liens des messages seraient cassés, donc rien ne part.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="notify-chat-id">Destinataire (chat ID)</Label>
            <Input
              id="notify-chat-id"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890"
              className="max-w-sm font-mono"
            />
            <p className="text-xs text-slate-500">
              Ajoute le bot au groupe, envoie <code>/start</code> dedans, puis
              ouvre <code>api.telegram.org/bot&lt;jeton&gt;/getUpdates</code> et
              relève <code>result[].message.chat.id</code> (négatif pour un
              groupe). Vider ce champ désactive le canal.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Une bascule par événement, groupées par urgence ───────────────── */}
      {SECTIONS.map((section) => (
        <Card key={section.kind}>
          <CardContent className="space-y-1 pt-6">
            <h2 className="text-sm font-semibold text-slate-900">
              {section.title}
            </h2>
            <p className="pb-2 text-xs text-slate-500">{section.blurb}</p>
            {NOTIFICATION_EVENTS.filter((e) => e.kind === section.kind).map(
              (evt) => (
                <div
                  key={evt.key}
                  className="flex items-start justify-between gap-4 border-t border-slate-100 py-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <Label
                      htmlFor={`notify-${evt.key}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {evt.label}
                    </Label>
                    <p className="text-xs text-slate-500">{evt.hint}</p>
                  </div>
                  <Switch
                    id={`notify-${evt.key}`}
                    checked={enabled.has(evt.key)}
                    onCheckedChange={(v) => toggle(evt.key, v)}
                  />
                </div>
              ),
            )}
            {/* Heure d'envoi — n'a de sens que pour la section planifiée. En
                heure de PARIS, pas UTC : le cron est horaire et ne tire que
                lorsque l'heure de Paris correspond, pour que « 21 h » reste
                21 h au changement d'heure d'octobre. */}
            {section.kind === "scheduled" && (
              <div className="flex items-center justify-between gap-4 border-t border-slate-100 py-3">
                <div className="min-w-0 space-y-0.5">
                  <Label htmlFor="notify-evening-hour" className="text-sm font-medium">
                    Heure d&apos;envoi
                  </Label>
                  <p className="text-xs text-slate-500">
                    Heure de Paris, été comme hiver.
                  </p>
                </div>
                <select
                  id="notify-evening-hour"
                  value={eveningHour}
                  onChange={(e) => setEveningHour(Number(e.target.value))}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm tabular-nums"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={saving || !dirty}>
          {saving && <Loader2Icon className="size-4 animate-spin" />}
          Enregistrer
        </Button>
        {dirty && (
          <span className="text-xs text-slate-500">
            Modifications non enregistrées.
          </span>
        )}
      </div>
    </div>
  );
}
