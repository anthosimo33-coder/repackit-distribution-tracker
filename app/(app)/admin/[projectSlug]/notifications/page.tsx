"use client";

import { NotificationSettings } from "@/components/admin/NotificationSettings";
import { PermissionGate } from "@/components/project/PermissionGate";

/**
 * Configuration des notifications hors-app du projet (canal, destinataire,
 * bascule par événement). Écran mince : toute la logique est dans le composant.
 */
function NotificationsPageContenu() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Notifications
        </h1>
        <p className="text-sm text-slate-500">
          Ce que Jarvia t&apos;envoie sur Telegram, et à qui. Réglable sans
          redéploiement, et propre à ce projet.
        </p>
      </header>
      <NotificationSettings />
    </div>
  );
}

/**
 * Garde d'écran : notifications.manage. Le menu ne propose plus cette page à qui n'a pas le
 * bloc, mais son URL répond toujours — sans cette enveloppe, y arriver par un
 * favori déclenche les queries de la page, qui lèvent, et on lit une erreur
 * technique au lieu d'une phrase.
 *
 * ⚠️ Ce n'est PAS la barrière : le serveur refuse déjà chaque appel.
 */
export default function NotificationsPage() {
  return (
    <PermissionGate bloc="notifications.manage">
      <NotificationsPageContenu />
    </PermissionGate>
  );
}
