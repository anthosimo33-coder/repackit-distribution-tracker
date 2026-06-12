import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * P5 — rendu markdown LÉGER (sous-ensemble suffisant pour les instructions de
 * warmup), sans dépendance ni dangerouslySetInnerHTML (convention du repo, cf
 * WarmupGuideAccordion.renderInline). Gère : titres `#`/`##`, listes `- `,
 * paragraphes (lignes vides = séparateur), inline **gras** + `code`.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${keyPrefix}-${i}`}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.8em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

export function SimpleMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    blocks.push(
      <ul
        key={`ul-${blocks.length}`}
        className="ml-4 list-disc space-y-1 text-slate-600"
      >
        {items.map((item, i) => (
          <li key={i}>{renderInline(item, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      flushList();
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      list.push(line.slice(2));
      return;
    }
    flushList();
    if (line.startsWith("## ")) {
      blocks.push(
        <h4
          key={`h-${idx}`}
          className="text-sm font-semibold text-slate-900"
        >
          {renderInline(line.slice(3), `h-${idx}`)}
        </h4>,
      );
      return;
    }
    if (line.startsWith("# ")) {
      blocks.push(
        <h3
          key={`h-${idx}`}
          className="text-base font-semibold text-slate-900"
        >
          {renderInline(line.slice(2), `h-${idx}`)}
        </h3>,
      );
      return;
    }
    blocks.push(
      <p key={`p-${idx}`} className="text-slate-600">
        {renderInline(line, `p-${idx}`)}
      </p>,
    );
  });
  flushList();

  return (
    <div className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {blocks}
    </div>
  );
}
