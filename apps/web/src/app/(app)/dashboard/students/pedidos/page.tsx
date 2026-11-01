import { withCurrent } from '@/components/sport-chip';
import { getTranslations } from 'next-intl/server';
import { apiFetch, type Classes, type Lead, type Leads, type Me, type RegistrationSettings } from '@/lib/api';
import { formatDate, formatStamp } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { appOrigin } from '@/lib/public-water-link';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';
import { LeadActions } from './lead-actions';
import type { TurmaOption } from '@/components/turma-picker';
import { RegistrationSettingsForm } from './registration-settings';
import { BASE_SPORT, isMultiSport, isPoolseSport, type PoolseSport } from '@poolse/rules';
import { FromLink } from '@/components/from-link';
import { SUB_MENU_ROW, subMenuPillClass } from '@/components/section-pills';
import { SportIcon, sportNameKey } from '@/components/sport-icon';
import { cn } from '@/lib/utils';

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
  // POOLSE-143: a sport's *Pedidos*, or the shared list's *Sem modalidade*.
  const sportParam = typeof params['sport'] === 'string' ? params['sport'] : undefined;
  const sport: PoolseSport | 'none' | undefined =
    sportParam === 'none' ? 'none' : isPoolseSport(sportParam) ? sportParam : undefined;
  const leadsQuery = (view?: 'done'): string => {
    const query = new URLSearchParams({ sportCounts: '1' });
    if (view !== undefined) query.set('view', view);
    if (sport !== undefined) query.set('sport', sport);
    return `/leads?${query.toString()}`;
  };

  const [openLeads, doneLeads, settings, me] = await Promise.all([
    outcome(apiFetch<Leads>(leadsQuery())),
    section === 'done' ? outcome(apiFetch<Leads>(leadsQuery('done'))) : Promise.resolve(null),
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
      <section className="flex flex-col gap-2 rounded bg-surface p-5 shadow-card">
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
    // The picker's rows (POOLSE-110): slots and instructor are already on the
    // turma, and the levels come in ladder order, which orders the groups.
    const ladder = classes.state === 'ok' ? classes.data.options.levels.map((level) => level.id) : [];
    const turmas: TurmaOption[] =
      classes.state === 'ok'
        ? classes.data.groups.map((g) => ({
            id: g.id,
            name: g.name,
            levelName: g.levelName,
            levelOrder: g.levelId === null || !ladder.includes(g.levelId) ? null : ladder.indexOf(g.levelId),
            capacity: g.capacity,
            active: g.students.filter((s) => s.status === 'active').length,
            slots: [...g.schedules]
              .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
              .map((slot) => ({ weekday: slot.weekday, startTime: slot.startTime })),
            instructorName: g.instructorName,
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

  /*
   * The sport chips — POOLSE-143, as on Alunos: everyone, each sport, and the
   * leads that name neither a turma nor a level (*Sem modalidade*). Only for a
   * club with a second sport; the section the reader is on stays.
   */
  const clubSports = me.state === 'ok' ? (me.data.memberships[0]?.sports ?? [BASE_SPORT]) : [BASE_SPORT];
  const counts = openLeads.data.sportCounts;
  const sportHref = (value: string | undefined): string => {
    const query = new URLSearchParams();
    if (section !== 'open') query.set('section', section);
    if (value !== undefined) query.set('sport', value);
    if (typeof params.from === 'string') query.set('from', params.from);
    const rest = query.toString();
    return rest === '' ? PATH : `${PATH}?${rest}`;
  };
  // A sport's own *Pedidos* (Rui, 01-11-2026): that sport and *Todos*, which goes
  // back to the shared queue; the shared queue keeps every chip.
  const sportPage = sport !== undefined && sport !== 'none';
  const sportChips =
    isMultiSport(clubSports) && counts !== undefined && section !== 'form' && sportPage ? (
      <nav aria-label={t('leads.sportFilter')} className={cn(SUB_MENU_ROW, 'items-center')}>
        <FromLink href={sportHref(undefined)} className={subMenuPillClass(false)}>
          {t('students.sportAll', { count: counts.total })}
        </FromLink>
        <span aria-current="page" className={subMenuPillClass(true)}>
          <SportIcon sport={sport} className="size-4" />
          {t(sportNameKey(sport))}
          <span className="tabular-nums opacity-80">
            {counts.bySport.find((one) => one.sport === sport)?.count ?? 0}
          </span>
        </span>
      </nav>
    ) : isMultiSport(clubSports) && counts !== undefined && section !== 'form' ? (
      <nav aria-label={t('leads.sportFilter')} className={cn(SUB_MENU_ROW, 'items-center')}>
        <FromLink href={sportHref(undefined)} aria-current={sport === undefined ? 'page' : undefined} className={subMenuPillClass(sport === undefined)}>
          {t('students.sportAll', { count: counts.total })}
        </FromLink>
        {withCurrent(counts.bySport, sport).map((entry) => (
          <FromLink
            key={entry.sport}
            href={sportHref(entry.sport)}
            aria-current={sport === entry.sport ? 'page' : undefined}
            className={subMenuPillClass(sport === entry.sport)}
          >
            <SportIcon sport={entry.sport} className="size-4" />
            {t(sportNameKey(entry.sport))}
            <span className="tabular-nums opacity-80">{entry.count}</span>
          </FromLink>
        ))}
        <FromLink href={sportHref('none')} aria-current={sport === 'none' ? 'page' : undefined} className={subMenuPillClass(sport === 'none')}>
          {t('students.sportNone', { count: counts.none })}
        </FromLink>
      </nav>
    ) : null;

  return shell(
    <div className="flex flex-col gap-5">
      <SectionPills items={pills} current={section} label={t('leads.sectionsLabel')} />
      {sportChips}
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
    <article className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          {lead.swimmerFirstName} {lead.swimmerLastName}
        </h2>
        <span className="text-sm text-foreground-muted">
          {t('leads.received', { when: formatStamp(lead.createdAt) })}
        </span>
      </header>

      <p className="text-sm font-medium">{t(`leads.status.${lead.status}`)}</p>

      {/*
        Asked for from the app (POOLSE-121): which turma, and by whom — the
        reason the request exists. Inscrever starts on that turma.
      */}
      {lead.requestedByName !== null && (
        <div className="flex flex-col gap-1 rounded border border-primary/40 bg-primary/5 p-3 text-sm">
          <span className="font-medium">
            {lead.requestedClassName === null
              ? t('leads.app.classGone')
              : t('leads.app.wants', { turma: lead.requestedClassName })}
          </span>
          {lead.requestedClassSlots.length > 0 && (
            <span className="text-foreground-muted">
              {lead.requestedClassSlots.map((slot) => `${t(`weekShort.${slot.weekday}`)} ${slot.startTime}`).join(' · ')}
            </span>
          )}
          <span className="text-foreground-muted">
            {lead.forExistingStudent
              ? t(lead.existingStudent ? 'leads.app.byExisting' : 'leads.app.byExistingDone', {
                  name: lead.requestedByName,
                })
              : t('leads.app.byNew', { name: lead.requestedByName })}
          </span>
        </div>
      )}

      {/*
        What the family wrote to the club, above the form's facts (Rui,
        29-10-2026): it is the one part they chose to say, and it may change how
        the request is handled. Always shown, so an empty one reads as "nothing
        written" rather than as a field the form does not have.
      */}
      <div className="flex flex-col gap-1 rounded border border-border bg-surface-muted p-3 text-sm">
        <span className="text-foreground-muted">{t('leads.public.note')}</span>
        {lead.note ? (
          <p className="whitespace-pre-wrap">{lead.note}</p>
        ) : (
          <p className="text-foreground-muted">{t('leads.noNote')}</p>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {lead.swimmerBirthDate !== null && (
          <Row label={t('leads.public.swimmerBirthDate')} value={formatDate(lead.swimmerBirthDate)} />
        )}
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
