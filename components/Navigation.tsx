"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/hooks", label: "Bibliothèque" },
  { href: "/tracker", label: "Tracker" },
  { href: "/comptes", label: "Comptes" },
  { href: "/nouveau", label: "Nouveau carrousel" },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="container mx-auto flex items-center gap-8 px-6 py-4">
        <span className="text-sm font-semibold tracking-tight text-slate-900">
          RepackIt Distribution
        </span>
        <div className="flex gap-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-slate-100 font-medium text-slate-900"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
