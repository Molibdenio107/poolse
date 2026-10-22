import { getTranslations } from 'next-intl/server';
import { apiFetch, type Classes, type Lead, type Leads, type Me, type RegistrationSettings } from '@/lib/api';
import { formatDate, formatStamp } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { appOrigin } from '@/lib/public-water-link';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';
import { LeadActions, type TurmaChoice } from './lead-actions';
import { RegistrationSettingsForm } from './registration-settings';

const PATH = '/dashboard/students/pedidos';
const SECTIONS = ['open', 'done', 'form'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Pedidos de inscrição — POOLSE-69.
 *
 * What families sent through the club's public form, worked one request at a
 * time: inscrever, lista de espera, aula experimental or dispensar, each a
 * question in a dialog and one call. Three sections behind pills — to answer,
 * answered, and the form's own switch and address — so the reader scrolls one
 * list rather than three.
 *
 * Owner and Admin; the API refuses everybody else, and so does the menu.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const params = await searchParams;
  const back = originBack(typeof params.from === 'string' ? params.from : undefined);
  const section: Section = pickSection(SECTIONS, params['section'], 'open');

  const [openLeads, doneLeads, settings, me] = await Promise.all([
    outcome(apiFetch<Leads>('/leads')),
    section === 'done' ? outcome(apiFetch<Leads>('/leads?view=done')) : Promise.resolve(null),
    outcome(apiFetch<RegistrationSettings>('/settings/registration')),
    outcome(apiFetch<Me>('/me')),
  ]);

  const shell = (children: React.ReactNode): React.ReactElement => (
    <PageShell
      title={t('leads.title')}
      subtitle={t('leads.subtitle')}
      back={backProp(back, t)}
    >
      {children}
    </PageShell>
  );

  if (openLeads.state === 'refused') {
    return shell(
      <section className="flex flex-col gap-2 rounded border border-border bg-surface p-5">
        <p className="font-medium">{t('leads.notPermitted')}</p>
      </section>,
    );
  }
  if (openLeads.state === 'failed') {
    return shell(<PageError message={t(openLeads.failure.key)} detail={openLeads.failure.detail} />);
  }

  const retentionMonths = openLeads.data.retentionMonths;
  const isOwner =
    me.state === 'ok' && (me.data.memberships[0]?.roles ?? []).includes('owner');

  const pills = SECTIONS.map((key) => ({
    key,
    label: t(`leads.section.${key}`),
    href: sectionHref(PATH, params, key),
    ...(key === 'open' ? { count: openLeads.data.leads.length } : {}),
  }));

  let body: React.ReactNode;
  if (section === 'form') {
    body =
      settings.state === 'ok' ? (
        <RegistrationSettingsForm settings={settings.data} origin={await appOrigin()} canEdit={isOwner} />
      ) : settings.state === 'failed' ? (
        <PageError message={t(settings.failure.key)} detail={settings.failure.detail} />
      ) : (
        <p className="text-sm text-foreground-muted">{t('leads.notPermitted')}</p>
      );
  } else if (section === 'done') {
    const done = doneLeads;
    body =
      done === null || done.state !== 'ok' ? (
        <PageError
          message={t(done !== null && done.state === 'failed' ? done.failure.key : 'leads.loadFailed')}
        />
      ) : done.data.leads.length === 0 ? (
        <PageEmpty message={t('leads.doneEmpty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {done.data.leads.map((lead) => (
            <li key={lead.id}>
              <LeadCard lead={lead} t={t} />
            </li>
          ))}
        </ul>
      );
  } else {
    const classes = await outcome(apiFetch<Classes>('/class-groups'));
    const turmas: TurmaChoice[] =
      classes.state === 'ok'
        ? classes.data.groups.map((g) => ({
            id: g.id,
            name: g.name,
            levelName: g.levelName,
            capacity: g.capacity,
            active: g.students.filter((s) => s.status === 'active').length,
          }))
        : [];
    const open = openLeads.data.leads;
    body =
      open.length === 0 ? (
        <PageEmpty
          message={t('leads.openEmpty')}
          hint={settings.state === 'ok' && !settings.data.open ? t('leads.openEmptyClosed') : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {open.map((lead) => (
            <li key={lead.id}>
              <LeadCard lead={lead} t={t}>
                <LeadActions lead={lead} turmas={turmas} />
              </LeadCard>
            </li>
          ))}
        </ul>
      );
  }

  return shell(
    <div className="flex flex-col gap-5">
      <SectionPills items={pills} current={section} label={t('leads.sectionsLabel')} />
      {/*
        The form drops requests past its ceiling without telling the sender —
        so it tells the club instead. 16-10-2026 sweep.
      */}
      {openLeads.data.ceilingReachedAt !== null && (
        <p className="rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {t('leads.ceilingReached', { when: formatStamp(openLeads.data.ceilingReachedAt) })}
        </p>
      )}
      {section !== 'form' && (
        <p className="text-sm text-foreground-muted">
          {t('leads.retention', { months: retentionMonths })}
        </p>
      )}
      {body}
    </div>,
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

/** Everything a family sent, as visible text — nothing here hides behind a tooltip. */
function LeadCard({
  lead,
  t,
  children,
}: {
  lead: Lead;
  t: T;
  children?: React.ReactNode;
}): React.ReactElement {
  const days = lead.preferredDays.map((d) => t(`week.${d}`)).join(', ');
  return (
    <article className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          {lead.swimmerFirstName} {lead.swimmerLastName}
        </h2>
        <span className="text-sm text-foreground-muted">
          {t('leads.received', { when: formatStamp(lead.createdAt) })}
        </span>
      </header>

      <p className="text-sm font-medium">{t(`leads.status.${lead.status}`)}</p>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label={t('leads.public.swimmerBirthDate')} value={formatDate(lead.swimmerBirthDate)} />
        {lead.swimmerTaxNumber && <Row label={t('leads.public.swimmerTaxNumber')} value={lead.swimmerTaxNumber} />}
        {lead.guardianName && (
          <Row
            label={t('leads.public.guardian')}
            value={[lead.guardianName, lead.guardianRelationship].filter(Boolean).join(' · ')}
          />
        )}
        {lead.guardianTaxNumber && <Row label={t('leads.public.guardianTaxNumber')} value={lead.guardianTaxNumber} />}
        <Row label={t('leads.public.email')} value={lead.email} />
        {lead.phone && <Row label={t('leads.public.phone')} value={lead.phone} />}
        <Row label={t('leads.public.level')} value={lead.levelName ?? t('leads.public.noPreference')} />
        {lead.facilityName && <Row label={t('leads.public.facility')} value={lead.facilityName} />}
        <Row label={t('leads.public.days')} value={days === '' ? t('leads.anyDay') : days} />
        {lead.trialStartsAt && (
          <Row
            label={t('leads.trialOn')}
            value={[lead.trialGroupName, formatStamp(lead.trialStartsAt)].filter(Boolean).join(' · ')}
          />
        )}
        {lead.dismissedReason && <Row label={t('leads.reason')} value={lead.dismissedReason} />}
        <Row
          label={t('leads.consentLabel')}
          value={t('leads.consentGiven', {
            when: formatStamp(lead.consentedAt),
            version: lead.consentTextVersion,
          })}
        />
      </dl>

      {lead.note && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-foreground-muted">{t('leads.public.note')}</span>
          <p className="whitespace-pre-wrap">{lead.note}</p>
        </div>
      )}

      {children}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
