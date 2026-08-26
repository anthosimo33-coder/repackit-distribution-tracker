"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useMyProfile } from "@/components/portal/creator-data";
import { useReadOnly } from "@/components/portal/ViewAsContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useConvexError } from "@/lib/use-convex-error";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/components/layout/LanguageSelector";

type PaymentMethod = "sepa" | "paypal" | "usdt" | "autre";

// Tables de CLÉS i18n, pas de libellés : `value` est la donnée envoyée au
// serveur (creators.paymentMethod), elle ne bouge pas. Seule sa traduction est
// résolue au rendu.
const METHODS = [
  { value: "sepa", labelKey: "profil.method.sepa" },
  { value: "paypal", labelKey: "profil.method.paypal" },
  { value: "usdt", labelKey: "profil.method.usdt" },
  { value: "autre", labelKey: "profil.method.autre" },
] as const satisfies ReadonlyArray<{ value: PaymentMethod; labelKey: string }>;

const DETAILS_PLACEHOLDER_KEY = {
  sepa: "profil.placeholder.sepa",
  paypal: "profil.placeholder.paypal",
  usdt: "profil.placeholder.usdt",
  autre: "profil.placeholder.autre",
} as const satisfies Record<PaymentMethod, string>;

/**
 * « Profil » — écran RÉUTILISÉ par le portail créateur normal ET le mode admin
 * « voir l'espace d'un créateur ». En lecture seule (view-as) : les champs de
 * paiement sont désactivés et le bouton « Enregistrer » est masqué (la mutation
 * updateMyProfile n'est de toute façon jamais appelée — et refuserait un admin,
 * qui n'a pas de membership creator).
 */
export default function ProfilScreen() {
  const showError = useConvexError();
  const t = useTranslations("portal");
  const projectId = useCreatorProjectId();
  const profile = useMyProfile(projectId);
  const readOnly = useReadOnly();
  const tSettings = useTranslations("settings.language");
  const updateProfile = useMutation(api.creators.updateMyProfile);

  // Valeurs éditées (null = pas encore touché → on affiche la valeur serveur).
  // Pattern override plutôt que setState-in-effect (interdit par eslint et
  // source de renders en cascade).
  const [phoneEdit, setPhoneEdit] = useState<string | null>(null);
  const [methodEdit, setMethodEdit] = useState<PaymentMethod | "" | null>(null);
  const [detailsEdit, setDetailsEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phone = phoneEdit ?? profile?.phone ?? "";
  const method: PaymentMethod | "" =
    methodEdit ?? (profile?.paymentMethod as PaymentMethod | null) ?? "";
  const details = detailsEdit ?? profile?.paymentDetails ?? "";

  async function onSave() {
    setBusy(true);
    try {
      await updateProfile({
        projectId,
        phone,
        paymentMethod: method === "" ? undefined : method,
        paymentDetails: details,
      });
      toast.success(t("profil.saved"));
    } catch (e) {
      toast.error(showError(e, t("profil.error")));
    } finally {
      setBusy(false);
    }
  }

  const loading = profile === undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {t("profil.title")}
      </h1>

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : profile === null ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">
            {t("profil.notFound")}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Identité (gérée par l'admin) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("profil.identityTitle")}</CardTitle>
              <CardDescription>
                {t("profil.identityHint")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t("profil.name")}</Label>
                <p className="text-sm text-slate-700">{profile.name}</p>
              </div>
              <div className="space-y-1">
                <Label>{t("profil.email")}</Label>
                <p className="text-sm text-slate-700">{profile.email}</p>
              </div>
            </CardContent>
          </Card>

          {/* Paiement (éditable par le créateur ; en lecture seule pour l'admin) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("profil.paymentTitle")}</CardTitle>
              <CardDescription>
                {t("profil.paymentHint")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("profil.phone")}</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhoneEdit(e.target.value)}
                  placeholder="+33 6 12 34 56 78"
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="method">{t("profil.methodLabel")}</Label>
                <Select
                  value={method}
                  onValueChange={(v) => v && setMethodEdit(v as PaymentMethod)}
                  disabled={readOnly}
                >
                  <SelectTrigger id="method" aria-label={t("profil.methodLabel")}>
                    <SelectValue placeholder={t("profil.methodPlaceholder")}>
                      {method
                        ? t(METHODS.find((m) => m.value === method)!.labelKey)
                        : t("profil.methodPlaceholder")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {t(m.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="details">{t("profil.detailsLabel")}</Label>
                <Input
                  id="details"
                  value={details}
                  onChange={(e) => setDetailsEdit(e.target.value)}
                  placeholder={
                    method ? t(DETAILS_PLACEHOLDER_KEY[method]) : t("profil.detailsPlaceholder")
                  }
                  disabled={readOnly}
                />
              </div>
              {!readOnly && (
                <div className="flex justify-end">
                  <Button
                    onClick={onSave}
                    disabled={busy}
                    className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
                  >
                    {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                    {t("profil.save")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/*
            Langue de l'interface. Le sélecteur n'existait QUE dans la sidebar
            admin : un créateur subissait la langue posée par l'admin à
            l'invitation, sans pouvoir la corriger — un créateur US invité par
            erreur en français restait bloqué en français.

            Masqué en lecture seule (view-as) : la mutation écrit sur
            `users.locale` de L'APPELANT, donc sur le compte de l'admin
            observateur. Le bouton changerait la langue de l'admin tout en
            paraissant agir sur celle de la créatrice observée.
          */}
          {!readOnly && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {tSettings("label")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LanguageSelector />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
