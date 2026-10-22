import { getTranslations } from 'next-intl/server';
import { formatDate } from '@/lib/date-format';
import { ComplaintsForm, PublishRegulation, WithdrawRegulationButton } from './regulation-forms';

export interface RegulationVersionView {
  id: string;
  effectiveFrom: string;
  body: string;
  publishedAt: string;
  publishedByName: string | null;
  current: boolean;
}

export interface ComplaintsSettingsView {
  regime: 'private' | 'public_service';
  url: string | null;
  officialUrl: string;
}

/**
 * The facility's operating regulation and where complaints go — POOLSE-73.
 *
 * The version in force first, in full; then every version with its day, so
 * "what did the rules say on the day of the incident" has an answer. The next
 * one is published from a button beside the header (POOLSE-92 G). The club's complaints setting sits below, said to be
 * club-wide, because it changes every public page and not this site's alone.
 */
export async function RegulationPanel({
  facilityId,
  versions,
  complaints,
  canManage,
  today,
}: {
  facilityId: string;
  versions: RegulationVersionView[];
  /** Null when this reader may not see the club's setting. */
  complaints: ComplaintsSettingsView | null;
  canManage: boolean;
  /** The site's today, `YYYY-MM-DD`, the form's default. */
  today: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const current = versions.find((v) => v.current) ?? null;
  const upcoming = versions.filter((v) => v.effectiveFrom > today);

  return (
    <div className="flex flex-col gap-6">
      {/* The tab's header: what this is, and — for owner and admin — its one action. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-foreground-muted">{t('regulation.hint')}</p>
        {canManage && (
          <PublishRegulation facilityId={facilityId} currentBody={current?.body ?? ''} today={today} />
        )}
      </div>

      {current === null ? (
        <p className="rounded border border-dashed border-border p-4 text-sm text-foreground-muted">
          {versions.length === 0 ? t('regulation.none') : t('regulation.noneInForce')}
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">
            {t('regulation.inForce', { date: formatDate(current.effectiveFrom) })}
          </h3>
          <div className="whitespace-pre-wrap rounded border border-border p-4 text-sm leading-relaxed">
            {current.body}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <p className="text-sm">
          {t('regulation.upcoming', { date: formatDate(upcoming[upcoming.length - 1]!.effectiveFrom) })}
        </p>
      )}

      {versions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('regulation.history')}</h3>
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">
                    {t('regulation.versionOf', { date: formatDate(version.effectiveFrom) })}
                    {version.current && ` · ${t('regulation.current')}`}
                    {version.effectiveFrom > today && ` · ${t('regulation.scheduled')}`}
                  </span>
                  <span className="text-foreground-muted">
                    {t('regulation.publishedBy', {
                      date: formatDate(version.publishedAt),
                      name: version.publishedByName ?? '—',
                    })}
                  </span>
                </span>
                {canManage && (
                  <WithdrawRegulationButton
                    facilityId={facilityId}
                    regulationId={version.id}
                    versionDate={formatDate(version.effectiveFrom)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {complaints !== null && (
        <section className="flex flex-col gap-3 rounded border border-border p-4">
          <h3 className="font-medium">{t('publicNotices.settingsTitle')}</h3>
          <p className="text-sm text-foreground-muted">{t('publicNotices.settingsHint')}</p>
          <ComplaintsForm
            facilityId={facilityId}
            regime={complaints.regime}
            url={complaints.url}
            officialUrl={complaints.officialUrl}
          />
        </section>
      )}
    </div>
  );
}
