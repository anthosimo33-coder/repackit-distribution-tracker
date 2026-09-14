/**
 * P1 Créateurs — libellés FR + classes de badge par statut. Source unique
 * (UI table + détail). Le cycle de vie : invited → onboarding → active, avec
 * paused / churned en sorties.
 */
export type CreatorStatus =
  | "invited"
  | "onboarding"
  | "active"
  | "paused"
  | "churned";

export const CREATOR_STATUS_ORDER: CreatorStatus[] = [
  "invited",
  "onboarding",
  "active",
  "paused",
  "churned",
];

/** Clés de libellé (`admin.creators.status.<clé>`) + habillage de la pastille. */
const META: Record<CreatorStatus, { key: CreatorStatus; className: string }> = {
  invited: {
    key: "invited",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  onboarding: {
    key: "onboarding",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  active: {
    key: "active",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  paused: {
    key: "paused",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  churned: {
    key: "churned",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

export function creatorStatusKey(status: CreatorStatus): CreatorStatus {
  return META[status].key;
}

export function creatorStatusBadge(status: CreatorStatus): {
  key: CreatorStatus;
  className: string;
} {
  return META[status];
}

/** Clés de libellé des moyens de paiement : `admin.creators.paymentMethod.<clé>`. */
export const PAYMENT_METHOD_KEYS: Record<string, string> = {
  sepa: "sepa",
  paypal: "paypal",
  usdt: "usdt",
  autre: "autre",
};
