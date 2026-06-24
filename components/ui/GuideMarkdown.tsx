import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  parseMarkdown,
  type InlineToken,
  type MarkdownBlock,
} from "@/lib/markdown";

/**
 * Rendu markdown SOIGNÉ pour les modules « Comment ça marche » (centre de
 * formation créateur). Aucune dépendance, aucun `dangerouslySetInnerHTML` : le
 * markdown (de confiance, saisi par l'admin) est parsé en blocs typés
 * (lib/markdown) puis rendu en éléments React → le HTML inline n'est jamais
 * interprété et les hrefs sont assainis. Liens en `target="_blank"` +
 * `rel="noopener noreferrer"`. Typo lisible et mobile-friendly.
 */

function renderInline(tokens: InlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((tok, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (tok.type) {
      case "bold":
        return (
          <strong key={key} className="font-semibold text-slate-900">
            {tok.value}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic">
            {tok.value}
          </em>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800"
          >
            {tok.value}
          </code>
        );
      case "link":
        // href null (URL non sûre) → on rend le label en texte simple.
        return tok.href ? (
          <a
            key={key}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sky-600 underline underline-offset-2 hover:text-sky-700"
          >
            {tok.label}
          </a>
        ) : (
          <span key={key}>{tok.label}</span>
        );
      default:
        return <span key={key}>{tok.value}</span>;
    }
  });
}

export function GuideMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseMarkdown(content);

  return (
    <div
      className={cn(
        "space-y-3 text-[15px] leading-relaxed text-slate-600",
        className,
      )}
    >
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}

function renderBlock(block: MarkdownBlock, i: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const content = renderInline(block.content, `h-${i}`);
      if (block.level === 1) {
        return (
          <h2
            key={i}
            className="mt-5 text-lg font-semibold text-slate-900 first:mt-0"
          >
            {content}
          </h2>
        );
      }
      if (block.level === 2) {
        return (
          <h3
            key={i}
            className="mt-4 text-base font-semibold text-slate-900 first:mt-0"
          >
            {content}
          </h3>
        );
      }
      return (
        <h4
          key={i}
          className="mt-3 text-sm font-semibold text-slate-900 first:mt-0"
        >
          {content}
        </h4>
      );
    }
    case "ul":
      return (
        <ul key={i} className="ml-5 list-disc space-y-1">
          {block.items.map((item, j) => (
            <li key={j}>{renderInline(item, `ul-${i}-${j}`)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} className="ml-5 list-decimal space-y-1">
          {block.items.map((item, j) => (
            <li key={j}>{renderInline(item, `ol-${i}-${j}`)}</li>
          ))}
        </ol>
      );
    default:
      return (
        <p key={i} className="whitespace-pre-wrap">
          {renderInline(block.content, `p-${i}`)}
        </p>
      );
  }
}
