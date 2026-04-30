# RepackIt Distribution Tracker

Tracker de distribution pour les carrousels TikTok et Instagram de RepackIt. Permet de centraliser, suivre et orchestrer la diffusion de contenus carrousel sur les deux plateformes.

## Stack

- **Next.js 16** (App Router) — `next@latest` (équivalent fonctionnel à Next.js 15 demandé : App Router, Server Components, Server Actions)
- **TypeScript** (strict)
- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- **shadcn/ui** — base color slate, CSS variables, preset `base-nova`
- **React 19**
- **pnpm** comme package manager

### Composants shadcn/ui installés

`button`, `input`, `select`, `dropdown-menu`, `dialog`, `table`, `card`, `badge`, `tabs`, `label`, `textarea`, `sonner` (remplace `toast`, déprécié dans le registry shadcn), `calendar`, `popover`.

## Contexte

Ce projet est l'outil interne de RepackIt pour suivre la distribution des carrousels (TikTok + Instagram) : programmation, statut de publication, métriques par plateforme, et reporting cross-canal.

## Commandes

```bash
pnpm dev      # Lance le dev server sur http://localhost:3000
pnpm build    # Build production
pnpm start    # Lance le build en mode production
pnpm lint     # Lint le code (ESLint + config Next.js)
```

## Structure

```
app/            # App Router (pages, layouts, route handlers)
components/ui/  # Composants shadcn/ui
lib/            # Utilitaires (cn, etc.)
public/         # Assets statiques
```
