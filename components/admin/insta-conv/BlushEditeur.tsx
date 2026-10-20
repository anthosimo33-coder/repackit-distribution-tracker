"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_IDEES,
  MAX_LIGNES_REPONSE,
  REGLAGES_BLUSH_DEFAUT,
  VERDICTS_BLUSH,
  type Conversation,
  type ConvMessage,
  type ReglagesBlush,
  type VerdictBlush,
} from "@/lib/insta-conv";
import { Choice, Field, ImagePick, type Tr } from "./champs";

/**
 * L'éditeur du chat BLUSH : l'en-tête et la saisie (l'autre, son verdict, votre
 * niveau, les bulles, les idées de questions), et la nature de chaque message
 * (texte, vocal, capture, « Ta meilleure réponse », citation, « BLUSH écrit »).
 */

const NOM_VERDICT: Record<VerdictBlush, "presque" | "partant" | "hesite" | "eloigne"> = {
  "🤏": "presque",
  "🔥": "partant",
  "🤔": "hesite",
  "🧊": "eloigne",
};

export function BlushReglagesFields({ conversation, tr, onChange }: { conversation: Conversation; tr: Tr; onChange: (p: Partial<Conversation>) => void }) {
  const r = conversation.blush ?? REGLAGES_BLUSH_DEFAUT;
  const poser = (p: Partial<ReglagesBlush>) => onChange({ blush: { ...r, ...p } });
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("blush.nom")} htmlFor="blush-nom" hint={tr("blush.nomAide")}>
          <Input id="blush-nom" value={conversation.contact.name} onChange={(e) => onChange({ contact: { ...conversation.contact, name: e.target.value } })} />
        </Field>
        <Field label={tr("blush.bulles")} htmlFor="blush-bulles" hint={tr("blush.bullesAide")}>
          <Input
            id="blush-bulles"
            type="number"
            min={0}
            max={9999}
            value={r.bulles}
            onChange={(e) => poser({ bulles: Math.max(0, Math.min(9999, Math.round(Number(e.target.value) || 0))) })}
          />
        </Field>
      </div>
      <Field label={tr("blush.verdict")}>
        <Choice<VerdictBlush>
          value={r.verdict}
          options={VERDICTS_BLUSH.map((v) => [v, `${v} ${tr(`blush.verdicts.${NOM_VERDICT[v]}`)}`] as const)}
          onChange={(verdict) => poser({ verdict })}
        />
      </Field>
      <Field label={tr("blush.niveau")} hint={tr("blush.niveauAide")}>
        <Choice value={String(r.niveau)} options={["1", "2", "3", "4"].map((n) => [n, `${n}/4`] as const)} onChange={(n) => poser({ niveau: Number(n) })} />
      </Field>
      <Field label={tr("blush.idees")} htmlFor="blush-idees" hint={tr("blush.ideesAide")}>
        <Textarea
          id="blush-idees"
          rows={2}
          value={r.idees.join("\n")}
          onChange={(e) => poser({ idees: e.target.value.split("\n").slice(0, MAX_IDEES) })}
        />
      </Field>
    </>
  );
}

type NatureBlush = "texte" | "vocal" | "capture" | "meilleure" | "citation" | "ecrit";

function natureDe(item: ConvMessage): NatureBlush {
  if (item.typing) return "ecrit";
  if (item.suggestion) return "meilleure";
  if (item.cited) return "citation";
  if (item.media?.type === "voice") return "vocal";
  if (item.media?.type === "photo" || item.media?.type === "video") return "capture";
  return "texte";
}

/** La nature choisie → les champs du message (les autres retirés ; le texte et l'image gardés). */
function champsPour(v: NatureBlush, item: ConvMessage): Partial<ConvMessage> {
  const aucun = { media: undefined, typing: undefined, suggestion: undefined, cited: undefined };
  const image = item.media && "image" in item.media && item.media.image ? { image: item.media.image } : {};
  if (v === "vocal") return { ...aucun, media: { type: "voice", seconds: item.media?.type === "voice" ? item.media.seconds : 7 } };
  if (v === "capture") return { ...aucun, media: { type: "photo", ...image } };
  if (v === "meilleure") return { ...aucun, suggestion: { lines: item.text ? [item.text] : [""] } };
  if (v === "citation") return { ...aucun, cited: { side: "in" } };
  if (v === "ecrit") return { ...aucun, typing: true };
  return aucun;
}

export function BlushMessageOptions({
  item,
  tr,
  onUpload,
  onChange,
}: {
  item: ConvMessage;
  tr: Tr;
  onUpload: (file: File) => Promise<string | null>;
  onChange: (p: Partial<ConvMessage>) => void;
}) {
  const nature = natureDe(item);
  const blush = item.side === "in";
  const natures: NatureBlush[] = blush ? ["texte", "vocal", "meilleure", "citation", "ecrit"] : ["texte", "vocal", "capture"];
  const sug = item.suggestion;
  const cited = item.cited;
  return (
    <div className="space-y-2">
      <Choice<NatureBlush> value={nature} options={natures.map((n) => [n, tr(`blush.natures.${n}`)] as const)} onChange={(v) => onChange(champsPour(v, item))} />
      {(nature === "texte" || nature === "citation") && (
        <Textarea aria-label={tr("texte")} rows={2} value={item.text} onChange={(e) => onChange({ text: e.target.value })} />
      )}
      {nature === "citation" && cited && (
        <div className="flex flex-wrap items-center gap-2">
          <Choice
            value={cited.side}
            options={[
              ["in", tr("blush.citationAutre")],
              ["out", tr("blush.citationElle")],
            ]}
            onChange={(side) => onChange({ cited: { ...cited, side } })}
          />
          <Input
            className="h-8 min-w-48 flex-1"
            aria-label={tr("blush.legendeCitation")}
            placeholder={tr("blush.legendeCitation")}
            value={cited.caption ?? ""}
            onChange={(e) => onChange({ cited: { ...cited, caption: e.target.value || undefined } })}
          />
        </div>
      )}
      {nature === "meilleure" && sug && (
        <div className="space-y-2">
          <Textarea
            aria-label={tr("blush.lignesReponse")}
            placeholder={tr("blush.lignesReponse")}
            rows={2}
            value={sug.lines.join("\n")}
            onChange={(e) => onChange({ suggestion: { ...sug, lines: e.target.value.split("\n").slice(0, MAX_LIGNES_REPONSE) } })}
          />
          <Input
            aria-label={tr("blush.pourquoi")}
            placeholder={tr("blush.pourquoi")}
            value={sug.why ?? ""}
            onChange={(e) => onChange({ suggestion: { ...sug, why: e.target.value || undefined } })}
          />
        </div>
      )}
      {nature === "vocal" && item.media?.type === "voice" && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          {tr("duree")}
          <Input
            className="h-8 w-20"
            type="number"
            min={1}
            max={600}
            value={item.media.seconds}
            onChange={(e) => onChange({ media: { type: "voice", seconds: Math.max(1, Math.min(600, Number(e.target.value) || 1)) } })}
          />
        </label>
      )}
      {nature === "capture" && (item.media?.type === "photo" || item.media?.type === "video") && (
        <ImagePick
          label={tr("blush.capture")}
          value={item.media.image}
          tr={tr}
          onUpload={onUpload}
          onChange={(image) => onChange({ media: { type: "photo", ...(image ? { image } : {}) } })}
        />
      )}
      {nature === "ecrit" && <p className="text-xs text-slate-500">{tr("blush.ecritAide")}</p>}
      {nature !== "ecrit" && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          {tr("blush.heureGroupe")}
          <Input className="h-8 w-24" placeholder={tr("heureExemple")} value={item.time ?? ""} onChange={(e) => onChange({ time: e.target.value || undefined })} />
        </label>
      )}
    </div>
  );
}
