"use client";

import { useMemo, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MAX_TAGS_DEFAULT = 20;

/**
 * Batch H — TagsInput chips removable avec autocomplete sur les tags
 * existants. Le composant normalise lui-même (trim + lowercase + dedupe)
 * avant onChange, donc le parent reçoit toujours un array propre. Le
 * serveur re-normalise par sécurité (defense in depth).
 *
 * Suggestions : passées en prop par le parent (memoized depuis
 * listInspirations). Pas de query Convex dédiée — les tags sont déjà en
 * mémoire dans la liste fetched.
 *
 * Limite 20 tags par défaut — limite UI uniquement (pas validée serveur,
 * mais le besoin pratique est < 10 tags par inspiration).
 */
export function TagsInput({
  value,
  onChange,
  suggestions,
  max = MAX_TAGS_DEFAULT,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  max?: number;
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function addTag(raw: string) {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length === 0) return;
    if (value.includes(normalized)) {
      setInput("");
      return;
    }
    if (value.length >= max) {
      toast.error(`Maximum ${max} tags`);
      return;
    }
    onChange([...value, normalized]);
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Tab" && input.trim().length > 0) {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && value.length > 0) {
      e.preventDefault();
      removeTag(value[value.length - 1]);
    }
  }

  function handleBlur() {
    // Délai pour permettre le click sur une suggestion avant qu'elle ne soit
    // unmount au blur de l'input. mousedown sur suggestion la sélectionne.
    blurTimeoutRef.current = setTimeout(() => setOpen(false), 150);
  }

  function handleFocus() {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    setOpen(true);
  }

  const matchingSuggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    return suggestions
      .filter((s) => !value.includes(s))
      .filter((s) => q === "" || s.includes(q))
      .slice(0, 8);
  }, [suggestions, value, input]);

  return (
    <div className="relative">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-200",
          disabled && "cursor-not-allowed opacity-60",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              disabled={disabled}
              aria-label={`Retirer le tag ${tag}`}
              className="rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={value.length === 0 ? "growth, b2b…" : ""}
          className="min-w-[80px] flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
          aria-label="Ajouter un tag"
        />
      </div>
      {open && matchingSuggestions.length > 0 && !disabled && (
        <ul
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-md"
          role="listbox"
        >
          {matchingSuggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                // mousedown au lieu de onClick : se déclenche avant le blur
                // de l'input → la suggestion s'ajoute sans race avec la
                // fermeture du dropdown.
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(s);
                  inputRef.current?.focus();
                }}
                className="flex w-full items-center px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
