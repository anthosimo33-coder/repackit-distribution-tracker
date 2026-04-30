"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/hooks", label: "Bibliothèque" },
  { href: "/tracker", label: "Tracker" },
  { href: "/nouveau", label: "Nouveau carrousel" },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="container mx-auto flex items-center gap-6 px-4 py-3">
        <span className="font-bold text-slate-900">RepackIt Distribution</span>
        <div className="flex gap-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm transition-colors",
                pathname === link.href
                  ? "font-medium text-slate-900"
                  : "text-slate-500 hover:text-slate-900",
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
