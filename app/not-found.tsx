import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-6xl font-bold text-slate-900">404</h1>
      <p className="text-slate-600">Cette page n&apos;existe pas.</p>
      <Link
        href="/"
        className="text-sm font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
      >
        Retour au Dashboard
      </Link>
    </div>
  );
}
