"use client";

import { useTranslations } from "next-intl";
import type { FormatKey } from "./format-config";

/**
 * Les libellés d'un format historique (Carrousel, Short, ScreenRecorder) dans la
 * langue du lecteur.
 *
 * `FORMAT_CONFIGS` garde ses libellés français : les écrans historiques, fermés
 * au manager, les lisent encore. Les écrans que le manager VOIT — la fenêtre
 * « New », la fiche d'un compte — passent par ici.
 */
export function useFormatLabels() {
  const t = useTranslations("admin.common.format");
  return {
    singular: (key: FormatKey) => t(`${key}.singular`),
    plural: (key: FormatKey) => t(`${key}.plural`),
    description: (key: FormatKey) => t(`${key}.description`),
  };
}
