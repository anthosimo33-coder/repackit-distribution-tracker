"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRightIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * P5 — accueil du portail créateur. La garde par rôle + le shell vivent dans
 * app/app/layout.tsx ; cette page n'est rendue que pour un creator.
 */
export default function CreatorHomePage() {
  const portal = useQuery(api.creators.getMyPortal, {});
  const name = portal?.creatorName ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Bienvenue{name ? ` ${name}` : ""}
        </h1>
        <p className="text-sm text-slate-500">
          Déclare tes comptes et suis ton protocole de warmup au quotidien.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mes comptes</CardTitle>
          <CardDescription>
            Déclare un compte, suis son warmup et coche ton check du jour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/app/comptes" className={buttonVariants()}>
            Aller à mes comptes
            <ArrowRightIcon className="ml-2 size-4" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
