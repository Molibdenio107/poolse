import { getTranslations } from 'next-intl/server';
import { ThemeToggle } from './theme-toggle';

type Health = { status: string; database: string };

async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch(`${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'}/health`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

/**
 * Slice 0.1's "done when": both apps boot and can see each other. Deliberately
 * plain — this page exists to prove the wiring, and gets replaced by the real
 * backoffice shell in phase 1.
 */
export default async function Page(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const health = await fetchHealth();

  const rows = [
    { label: t('health.api'), ok: health !== null },
    { label: t('health.database'), ok: health?.database === 'ok' },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('app.name')}</h1>
          <p className="text-foreground-muted">{t('app.tagline')}</p>
        </div>
        <ThemeToggle label={t('theme.toggle')} />
      </header>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('health.title')}
        </h2>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-4">
              <span>{row.label}</span>
              <span
                className={`rounded px-2 py-0.5 text-sm ${
                  row.ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
                }`}
              >
                {row.ok ? t('health.ok') : t('health.unreachable')}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
