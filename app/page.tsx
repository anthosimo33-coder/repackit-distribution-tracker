export default function Home() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-2xl font-medium">
        {hasUrl ? "Connected to Convex" : "No Convex URL"}
      </p>
    </div>
  );
}
