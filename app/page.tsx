export default function Home() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <p className="text-2xl font-medium">
        {hasUrl ? "Connected to Convex" : "No Convex URL"}
      </p>
    </main>
  );
}
