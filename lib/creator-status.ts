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

const META: Record<CreatorStatus, { label: string; className: string }> = {
  invited: {
    label: "Invité",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  onboarding: {
    label: "Onboarding",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  active: {
    label: "Actif",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  paused: {
    label: "En pause",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  churned: {
    label: "Parti",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

export function creatorStatusLabel(status: CreatorStatus): string {
  return META[status].label;
}

export function creatorStatusBadge(status: CreatorStatus): {
  label: string;
  className: string;
} {
  return META[status];
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  sepa: "Virement SEPA",
  paypal: "PayPal",
  usdt: "USDT",
  autre: "Autre",
};
