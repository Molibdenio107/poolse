import { getLocale, getTranslations } from 'next-intl/server';
import type { AppFreeSwim } from '@/lib/api';
import { formatDate, formatDateLong } from '@/lib/date-format';

/**
 * *Horário de nado livre* — POOLSE-237 (Rui, 19-11-2026). Per site: a tank
 * running free swim now as *Agora: 60 % ocupado (12 de 20) · às 18:42*, then
 * today and the next 7 days' hours, lanes and closures. Counts only, never a
 * person; a tank with no capacity shows its hours and no number. The bar beside
 * the sentence repeats it and is hidden from screen readers: the text carries it.
 */
export async function FreeSwimSchedule({
  sites,
}: {
  sites: AppFreeSwim['sites'];
}): Promise<React.ReactElement | null> {
  if (sites.length === 0) return null;
  const t = await getTranslations();
  const locale = await getLocale();
  const dayName = (today: string, date: string): string =>
    date === today ? t('app.freeSwim.today') : date === nextDay(today) ? t('app.freeSwim.tomorrow') : formatDateLong(date, locale);

  return (
    <section aria-labelledby="free-swim-schedule" className="flex flex-col gap-3">
      <h2 id="free-swim-schedule" className="text-base font-semibold">
        {t('app.freeSwim.title')}
      </h2>
      {sites.map((site) => (
        <div key={site.facilityId} className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card">
          {sites.length > 1 && <h3 className="font-semibold">{site.name}</h3>}

          {site.now.map((now) => (
            <div key={`${now.poolName}-${now.from}`} className="flex flex-col gap-1.5">
              <p className="text-sm">
                <span className="font-semibold">
                  {t('app.freeSwim.now', { percent: now.percent, occupied: now.occupied, capacity: now.capacity })}
                </span>
                <span className="text-foreground-muted">
                  {' · '}
                  {now.poolName} · {t('app.freeSwim.readAt', { time: now.readAt })}
                </span>
              </p>
              <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, now.percent)}%` }} />
              </div>
            </div>
          ))}

          <ul className="flex flex-col divide-y divide-border">
            {site.days.map((day) => (
              <li key={day.date} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                <span className="text-sm font-semibold">{dayName(site.today, day.date)}</span>
                {day.closed.map((closed) => (
                  <span key={closed.poolName} className="text-sm text-foreground-muted">
                    {t('app.freeSwim.closed', { pool: closed.poolName, date: formatDate(closed.until) })}
                  </span>
                ))}
                {day.sessions.map((session, index) => (
                  <span key={`${session.from}-${session.poolName ?? ''}-${index}`} className="text-sm">
                    {[
                      `${session.from}–${session.to}`,
                      session.poolName,
                      session.lanes > 0 ? t('app.freeSwim.lanes', { count: session.lanes }) : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' · ')}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
