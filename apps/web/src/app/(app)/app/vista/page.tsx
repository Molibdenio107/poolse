import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ChevronRight, LayoutDashboard, Users, Waves, Wrench, type LucideIcon } from 'lucide-react';
import { PageError } from '@/components/page-shell';
import { LinkBusy } from '@/components/link-busy';
import { SearchInput } from '@/components/search-input';
import { apiFetch, type Me } from '@/lib/api';
import { BUILT_HATS, hatsOf, type AppHat } from '@/lib/app-hats';
import { outcome } from '@/lib/load-failure';
import { chooseBackofficeAction, chooseOwnHomeAction } from './view.actions';
import { ViewPeople } from './view-people';

const HATS: { hat: AppHat; icon: LucideIcon }[] = [
  { hat: 'family', icon: Users },
  { hat: 'teaching', icon: Waves },
  { hat: 'maintenance', icon: Wrench },
];

const ROW =
  'flex min-h-[64px] w-full items-center justify-between gap-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Como quer entrar?* — POOLSE-188. An owner, an admin or a support session meets
 * this the first time they open the app, and from *O meu perfil* after that.
 * Anybody else is sent home: the API refuses them regardless (QA 8).
 */
export default async function ViewPickerPage({
  searchParams,
}: {
  searchParams: Promise<{ home?: string; search?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { home, search } = await searchParams;

  const me = await apiFetch<Me>('/me').catch(() => null);
  const membership = me?.memberships[0];
  if (membership === undefined) redirect('/dashboard');
  const hats = hatsOf(membership.roles);
  if (membership.view !== null || !hats.manages) redirect('/app');

  const hat = BUILT_HATS.find((one) => one === home);
  if (hat === undefined) {
    return (
      <>
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{t('appView.title')}</h1>
          <p className="text-sm text-foreground-muted">{t('appView.explain')}</p>
        </header>
        <div className="flex flex-col divide-y divide-border">
          <form action={chooseBackofficeAction}>
            <button type="submit" className={ROW}>
              <Option icon={LayoutDashboard} label={t('appView.backoffice')} hint={t('appView.backofficeHint')} />
              <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
            </button>
          </form>
          {HATS.filter((one) => hats.homes.includes(one.hat)).map((one) => (
            <form key={one.hat} action={chooseOwnHomeAction.bind(null, one.hat)}>
              <button type="submit" className={ROW}>
                <Option icon={one.icon} label={t(`appView.own.${one.hat}`)} hint={t('appView.ownHint')} />
                <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
              </button>
            </form>
          ))}
        </div>
        <h2 className="pt-2 text-sm font-semibold text-foreground-muted">{t('appView.others')}</h2>
        <div className="flex flex-col divide-y divide-border">
          {HATS.map((one) => (
            <Link key={one.hat} href={`/app/vista?home=${one.hat}`} className={ROW}>
              <Option icon={one.icon} label={t(`appView.${one.hat}`)} hint={t(`appView.${one.hat}Hint`)} />
              <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
              <LinkBusy />
            </Link>
          ))}
        </div>
      </>
    );
  }

  const query = new URLSearchParams({ hat });
  if (search !== undefined && search !== '') query.set('search', search);
  const loaded = await outcome(
    apiFetch<{ people: { membershipId: string; name: string }[]; more: boolean }>(`/app-view/people?${query}`),
  );

  return (
    <>
      <Link
        href="/app/vista"
        aria-label={t('appView.backToChoice')}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{t(`appView.${hat}`)}</h1>
      <SearchInput label={t('appView.search')} />
      {loaded.state === 'ok' ? (
        loaded.data.people.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('appView.none')}</p>
        ) : (
          <>
            <ViewPeople hat={hat} people={loaded.data.people} support={membership.supportExpiresAt !== null} />
            {loaded.data.more && <p className="text-sm text-foreground-muted">{t('appView.more')}</p>}
          </>
        )
      ) : (
        <PageError message={t(loaded.state === 'failed' ? loaded.failure.key : 'common.notAllowed')} />
      )}
    </>
  );
}

function Option({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
}): React.ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Icon className="size-5 shrink-0 text-primary" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-sm font-normal text-foreground-muted">{hint}</span>
      </span>
    </span>
  );
}
