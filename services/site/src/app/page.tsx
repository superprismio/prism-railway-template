import Link from "next/link";

const apiBase = process.env.API_INTERNAL_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:4010';

async function getHealth() {
  try {
    const response = await fetch(`${apiBase}/api/health`, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<{ ok: boolean; service: string; timestamp: string }>;
  } catch {
    return null;
  }
}

export default async function Page() {
  const health = await getHealth();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(236,110,57,0.18),transparent_28rem),radial-gradient(circle_at_bottom_right,rgba(53,110,196,0.18),transparent_24rem),linear-gradient(180deg,#f4f0e8,#f7f4ee_42%,#efe8dd)] px-4 py-6 text-foreground md:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[32px] border border-border/60 bg-card/90 p-8 shadow-[0_24px_80px_-36px_rgba(26,31,44,0.45)] backdrop-blur md:p-10">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-primary">Prism Agent</p>
          <h1 className="mt-4 max-w-3xl font-[family-name:var(--font-serif)] text-5xl leading-none tracking-tight md:text-7xl">
            Change requests in front, controlled agent execution behind.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            This stack is evolving into a request board that can route work to safe staging targets, feed context from
            Prism Memory, and keep production changes under human review.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
              href="/admin"
            >
              Open admin board
            </Link>
            <a
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-5 py-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
              href="https://docs.railway.com/templates/create"
              rel="noreferrer"
              target="_blank"
            >
              Railway template docs
            </a>
          </div>
        </section>

        <section className="rounded-[32px] border border-border/60 bg-[#1d2433] p-8 text-white shadow-[0_24px_80px_-36px_rgba(26,31,44,0.6)]">
          <p className="text-xs uppercase tracking-[0.24em] text-white/60">API status</p>
          <pre className="mt-4 overflow-auto rounded-2xl bg-white/6 p-5 text-sm leading-6 text-white/90">
            {JSON.stringify(health ?? { ok: false, service: 'api', timestamp: null }, null, 2)}
          </pre>
        </section>
      </div>
    </main>
  );
}
