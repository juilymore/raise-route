import { BRAND } from "@/config/brand";

// Placeholder shell for P01. The real Command Centre is built in P07.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-3xl font-bold">{BRAND.name}</h1>
      <p className="text-ink-500">{BRAND.tagline}</p>
      <p className="text-sm text-ink-500">
        Foundation phase. Check <a className="text-brand underline" href="/api/health">/api/health</a>.
      </p>
    </main>
  );
}
