"use client";

import { NotificationSettings } from "@/components/admin/NotificationSettings";

/**
 * Configuration des notifications hors-app du projet (canal, destinataire,
 * bascule par événement). Écran mince : toute la logique est dans le composant.
 */
export default function NotificationsPage() {
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
