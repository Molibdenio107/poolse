import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { CalendarDays, FileSpreadsheet, Plus, Waves } from 'lucide-react';
import { COUNTRY_CODES } from '@poolse/rules';
import { PageError, PageShell } from '@/components/page-shell';
import { FromLink } from '@/components/from-link';
import { ApiError, apiFetch, type Facilities, type FacilityDetail, type People } from '@/lib/api';
import { ClubContactsPanel, TaxPanel } from '../facilities/[facilityId]/tax-panel';
import { LogoPanel } from '../facilities/[facilityId]/logo-panel';
import { SiteDetailsForm } from '../facilities/[facilityId]/address-field';
import { CityPicker } from '../facilities/[facilityId]/city-picker';
import { HoursPanel } from '../facilities/[facilityId]/hours-panel';
import { readTaxSettings } from '../facilities/[facilityId]/club.actions';
import { InviteForm } from '../facilities/staff/invite-form';
import { StepControls } from './step-controls';
import { SetupHeader } from './stepper';
import { isSetupStep, SETUP_STEPS, type SetupStep, type WizardState } from './steps';

/** The staff roles an Owner invites here; family roles come from the student (POOLSE-129). */
const TEAM_ROLES = ['admin', 'instructor', 'maintenance'];

const CARD = 'flex flex-col gap-4 rounded bg-surface p-5 shadow-card';
const HEADING = 'text-sm font-medium uppercase tracking-wider text-foreground-muted';

/**
 * The Owner's setup after creating a club — POOLSE-228 (Rui, 19-11-2026).
 *
 * The creation form stays one screen; this comes after it, and every step can be
 * left with *Configurar mais tarde*. Each step is the screens' own panels
 * mounted here — the NIF, the contacts, the logo and the site's morada; the
 * pools and the opening hours; the invite form; the importers — so the wizard
 * holds no setting of its own and nothing it saves can disagree with the page
 * that owns it. `GET /onboarding` is the pointer, and only the Owner of a club
 * created since this ticket has one: anybody else is sent to Início.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  let wizard: WizardState | null = null;
  try {
    ({ wizard } = await apiFetch<{ wizard: WizardState | null }>('/onboarding'));
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 403) throw error;
  }
  if (wizard === null || wizard.step === null) redirect('/dashboard/welcome');

  const asked = (await searchParams).step;
  const step: SetupStep = isSetupStep(asked) ? asked : wizard.step;
  const index = SETUP_STEPS.indexOf(step);
  const previous = index > 0 ? SETUP_STEPS[index - 1]! : null;

  return (
    <PageShell title={t('setup.title')}>
      <SetupHeader step={step} behind={SETUP_STEPS.indexOf(wizard.step)} />

      {step === 'club' && <ClubStep />}
      {step === 'places' && <PlacesStep />}
      {step === 'team' && <TeamStep />}
      {step === 'import' && <ImportStep />}

      <StepControls
        step={step}
        previous={previous}
        {...(step === 'import' ? { nextLabelKey: 'setup.step.import.none' } : {})}
      />
    </PageShell>
  );
}

/** The club's first site: the one creation made. Several or none, the step says so. */
async function firstSite(): Promise<FacilityDetail | null> {
  const list = await apiFetch<Facilities>('/facilities');
  const first = list.facilities[0];
  return first === undefined ? null : apiFetch<FacilityDetail>(`/facilities/${first.id}`);
}

/** 1 · Clube: the NIF, the morada (the site's), the logo and the contacts. The name was asked at creation. */
async function ClubStep(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const [tax, site] = await Promise.all([readTaxSettings(), firstSite().catch(() => null)]);
  if (tax.state !== 'ok') return <PageError message={t('setup.loadFailed')} />;
  const locale = await getLocale();
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const countries = COUNTRY_CODES.map((code) => ({ value: code, label: regionNames.of(code) ?? code })).sort(
    (a, b) => a.label.localeCompare(b.label, locale),
  );

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <h3 className={HEADING}>{t('settings.tax.title')}</h3>
        <TaxPanel settings={tax.data} />
      </section>
      {site !== null && (
        <section className={CARD}>
          <h3 className={HEADING}>{t('setup.step.club.address')}</h3>
          <SiteDetailsForm
            facilityId={site.id}
            canRename={site.canRename}
            clubName={tax.data.clubName}
            facilityName={site.name}
            address={site.address}
            postalCode={site.postalCode}
            district={site.district}
            countryCode={site.countryCode}
            countries={countries}
            locality={
              <CityPicker
                key="locality"
                organizationId={site.organizationId}
                facilityId={site.id}
                city={site.city}
                countryCode={site.countryCode}
              />
            }
          />
        </section>
      )}
      <section className={CARD}>
        <h3 className={HEADING}>{t('clubData.contacts.title')}</h3>
        <ClubContactsPanel settings={tax.data} />
      </section>
      <LogoPanel />
    </div>
  );
}

/** 2 · Recintos e horário: the site's pools, and when it opens. */
async function PlacesStep(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const site = await firstSite().catch(() => null);
  if (site === null) return <PageError message={t('setup.loadFailed')} />;

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <h3 className={HEADING}>{t('setup.step.places.pools')}</h3>
        {site.pools.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('setup.step.places.noPools')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {site.pools.map((pool) => (
              <li key={pool.id} className="flex items-center gap-2">
                <Waves className="size-4 text-primary" aria-hidden />
                {pool.name}
              </li>
            ))}
          </ul>
        )}
        <FromLink
          href={`/dashboard/facilities/pools/new?facilityId=${site.id}`}
          className="inline-flex h-control items-center justify-center gap-2 self-start rounded-sm bg-surface px-4 text-control shadow-card"
        >
          <Plus className="size-4" aria-hidden />
          {t('facilities.newPool')}
        </FromLink>
      </section>
      <section className={CARD}>
        <h3 className={HEADING}>{t('facilities.hours')}</h3>
        <HoursPanel organizationId={site.organizationId} facilityId={site.id} hours={site.hours} canManage={site.canManage} />
      </section>
    </div>
  );
}

/** 3 · Convidar equipa: the Staff page's own invite form, staff roles only. */
async function TeamStep(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const people = await apiFetch<People>('/people?page=1').catch(() => null);
  if (people === null) return <PageError message={t('setup.loadFailed')} />;
  const roles = people.grantableRoles.filter((role) => TEAM_ROLES.includes(role));

  return (
    <section className={CARD}>
      <InviteForm organizationId={people.organizationId} grantableRoles={roles} />
    </section>
  );
}

/** 4 · Já tem alunos ou horários numa folha? The existing importers; `FromLink` stamps this step as their way back. */
async function ImportStep(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const link =
    'flex items-start gap-3 rounded border border-border p-4 transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <li className="flex">
        <FromLink href="/dashboard/students/import" className={`${link} w-full`}>
          <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t('setup.step.import.students')}</span>
            <span className="text-sm text-foreground-muted">{t('setup.step.import.studentsHint')}</span>
          </span>
        </FromLink>
      </li>
      <li className="flex">
        <FromLink href="/dashboard/calendar" className={`${link} w-full`}>
          <CalendarDays className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t('setup.step.import.timetable')}</span>
            <span className="text-sm text-foreground-muted">{t('setup.step.import.timetableHint')}</span>
          </span>
        </FromLink>
      </li>
    </ul>
  );
}
