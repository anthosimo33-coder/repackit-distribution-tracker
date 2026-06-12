"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * Remédiation sécurité — ConvexProvider nu remplacé par le provider Convex
 * Auth pour Next App Router. Couplé à ConvexAuthNextjsServerProvider dans
 * app/layout.tsx et au proxy.ts (cookies de session gérés côté serveur).
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
