"use client";

import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import type { WinnerRule } from "@/convex/challengeScore";
import {
  deadlineParts,
  modeKey,
  rewardLabel,
  statusKey,
  winnerRuleKey,
  type ChallengeReward,
} from "./challenge-format";

/**
 * Les libellés d'un défi, dans la langue de la personne qui les lit.
 *
 * `challenge-format` reste PUR (clés et calculs, testables sans React) ; ce hook
 * est le seul point qui les rebranche sur le catalogue — même découpage que
 * `lib/use-label`.
 */
export function useChallengeLabels() {
  const t = useTranslations("admin.challenges");
  const loc = useIntlLocale();
  return {
    locale: loc,
    mode: (mode: string) => t(`mode.${modeKey(mode)}`),
    modeHelp: (mode: string) => t(`modeHelp.${modeKey(mode)}`),
    status: (status: string) => t(`status.${statusKey(status)}`),
    winnerRule: (rule: WinnerRule) => {
      const { key, n } = winnerRuleKey(rule);
      return t(`winnerRule.${key}`, { n: n ?? 0 });
    },
    deadline: (deadline: number, now: number) =>
      t("deadline.label", deadlineParts(deadline, now)),
    reward: (
      reward: ChallengeReward,
      rule: WinnerRule | undefined,
      currency: string | null | undefined,
    ) =>
      rewardLabel(reward, rule, currency, {
        locale: loc,
        natureDefault: t("reward.natureDefault"),
        perWinner: (base) => t("reward.perWinner", { base }),
      }),
  };
}
