import Image from 'next/image';
import Link from 'next/link';
import {
  Building2,
  Check,
  GraduationCap,
  Hotel,
  House,
  KeyRound,
  Languages,
  LockKeyhole,
  Smartphone,
  Timer,
  Undo2,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { translator, type MarketingLocale } from './content';
import { MarketingShell } from './shell';

/**
 * The landing page, for both locales — redesigned 09-11-2026 (Rui).
 *
 * Still honest in the way the first one was: no customer names, no logos, no
 * counts and no testimonials, because none exist yet. What changed is that the
 * product now exists, so the page shows it: real screenshots of the running app
 * (`public/marketing/`, captured from the seed's demonstration club, its name
 * shown as "Clube Exemplo"), in a light and a dark copy that follow the theme.
 * Anything not built stays under *A caminho*, and the line under the hero says
 * the data is demonstration data.
 *
 * Static on purpose: no session, no cookies, prerendered at build time. Images
 * are `unoptimized` so the pilot's free tier never pays for image resizing; the
 * files are already WebP at the size they are shown.
 */

const AUDIENCE: { key: string; icon: LucideIcon }[] = [
  { key: 'schools', icon: GraduationCap },
  { key: 'municipal', icon: Building2 },
  { key: 'hotels', icon: Hotel },
  { key: 'owners', icon: House },
];

const TRUST: { key: string; icon: LucideIcon }[] = [
  { key: 'health', icon: LockKeyhole },
  { key: 'support', icon: KeyRound },
  { key: 'retention', icon: Timer },
  { key: 'roles', icon: Users },
  { key: 'undo', icon: Undo2 },
  { key: 'languages', icon: Languages },
];

const APPS: { key: string; icon: LucideIcon }[] = [
  { key: 'families', icon: Users },
  { key: 'teachers', icon: Smartphone },
  { key: 'maintenance', icon: Wrench },
];

const EVERYTHING = [
  'competition',
  'preRegistration',
  'staff',
  'safety',
  'messages',
  'imports',
  'sports',
  'complaints',
] as const;

const COMING = ['certified', 'payments'] as const;

/** Each pillar's four points, by index, so the catalogue keeps them as an array. */
const POINTS = [0, 1, 2, 3] as const;

const button =
  'inline-flex h-control items-center justify-center px-4 text-control rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function Landing({ locale }: { locale: MarketingLocale }): React.ReactElement {
  const t = translator(locale);
  const pricing = locale === 'pt-PT' ? '/pricing' : '/en/pricing';

  return (
    <MarketingShell locale={locale}>
      {/* Hero: what it is, two ways in, and the product itself. */}
      <section className="overflow-hidden bg-[radial-gradient(55%_60%_at_85%_0%,rgb(var(--primary)/0.16),transparent),radial-gradient(45%_50%_at_0%_100%,rgb(var(--complementary)/0.22),transparent)]">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pb-24 lg:pt-24">
          <div className="flex flex-col gap-6">
            <p className="text-sm font-semibold text-primary">{t('marketing.eyebrow')}</p>
            <h1 className="font-heading text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              {t('marketing.headline')}
            </h1>
            <p className="text-lg text-foreground-muted">{t('marketing.subhead')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/sign-up" className={cn(button, 'bg-primary font-semibold text-primary-foreground')}>
                {t('marketing.startFree')}
              </Link>
              <Link href={pricing} className={cn(button, 'bg-surface shadow-card hover:bg-surface-muted')}>
                {t('marketing.seePricing')}
              </Link>
            </div>
            <p className="text-sm text-foreground-muted">{t('marketing.trialNote')}</p>
          </div>

          <figure className="relative pb-10 lg:pb-0">
            <BrowserShot name="classes" alt={t('marketing.shot.classes')} priority />
            <div className="absolute -bottom-2 left-4 w-[28%] min-w-[110px] sm:left-8 lg:-bottom-10 lg:-left-10">
              <PhoneShot name="teacher" alt={t('marketing.shot.teacher')} priority />
            </div>
            <figcaption className="sr-only">{t('marketing.shotNote')}</figcaption>
          </figure>
        </div>
        <p className="mx-auto max-w-6xl px-6 pb-8 text-xs text-foreground-muted lg:text-right">
          {t('marketing.shotNote')}
        </p>
      </section>

      {/* Who it is for. */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{t('marketing.audience.title')}</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCE.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col gap-2 rounded bg-surface p-5 shadow-card">
              <Icon className="size-6 text-primary" aria-hidden />
              <span className="font-semibold">{t(`marketing.audience.${key}.title`)}</span>
              <span className="text-sm text-foreground-muted">{t(`marketing.audience.${key}.body`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Three pillars, alternating sides. Money has no screenshot: its screens are a club's own figures. */}
      <Pillar t={t} name="teaching" shot={{ name: 'week', alt: t('marketing.shot.week') }} />
      <Pillar t={t} name="money" flip />
      <Pillar t={t} name="pool" shot={{ name: 'energy', alt: t('marketing.shot.energy') }} />

      {/* The phone apps. */}
      <section className="bg-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <h2 className="font-heading text-3xl font-semibold tracking-tight">{t('marketing.apps.title')}</h2>
            <p className="max-w-2xl text-lg text-foreground-muted">{t('marketing.apps.body')}</p>
            <ul className="grid gap-4 sm:grid-cols-3">
              {APPS.map(({ key, icon: Icon }) => (
                <li key={key} className="flex flex-col gap-2 rounded bg-background p-5">
                  <Icon className="size-6 text-primary" aria-hidden />
                  <span className="font-semibold">{t(`marketing.apps.${key}.title`)}</span>
                  <span className="text-sm text-foreground-muted">{t(`marketing.apps.${key}.body`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-[260px]">
            <PhoneShot name="teacher" alt={t('marketing.shot.teacher')} />
          </div>
        </div>
      </section>

      {/* Trust. */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-heading text-3xl font-semibold tracking-tight">{t('marketing.trust.title')}</h2>
        <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded bg-primary/15">
                <Icon className="size-5 text-primary" aria-hidden />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-semibold">{t(`marketing.trust.${key}.title`)}</span>
                <span className="text-sm text-foreground-muted">{t(`marketing.trust.${key}.body`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* And also, then what is not built. */}
      <section className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-14 px-6 py-16">
          <div className="flex flex-col gap-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
              {t('marketing.everything.title')}
            </h2>
            <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              {EVERYTHING.map((item) => (
                <li key={item} className="flex flex-col gap-0.5">
                  <span className="font-semibold">{t(`marketing.everything.${item}.title`)}</span>
                  <span className="text-sm text-foreground-muted">{t(`marketing.everything.${item}.body`)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
              {t('marketing.comingLater')}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {COMING.map((item) => (
                <li key={item} className="flex flex-col gap-1 rounded border border-dashed border-border p-5">
                  <span className="font-semibold">{t(`marketing.coming.${item}.title`)}</span>
                  <span className="text-sm text-foreground-muted">{t(`marketing.coming.${item}.body`)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-foreground-muted">{t('marketing.comingNote')}</p>
          </div>
        </div>
      </section>

      {/* The last word. */}
      <section className="bg-[radial-gradient(60%_80%_at_50%_100%,rgb(var(--primary)/0.16),transparent)]">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 px-6 py-24 text-center">
          <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{t('marketing.ctaTitle')}</h2>
          <p className="text-lg text-foreground-muted">{t('marketing.ctaBody')}</p>
          <Link href="/sign-up" className={cn(button, 'bg-primary font-semibold text-primary-foreground')}>
            {t('marketing.startFree')}
          </Link>
          <p className="text-sm text-foreground-muted">{t('marketing.trialNote')}</p>
        </div>
      </section>
    </MarketingShell>
  );
}

function Pillar({
  t,
  name,
  shot,
  flip = false,
}: {
  t: (key: string) => string;
  name: 'teaching' | 'money' | 'pool';
  shot?: { name: string; alt: string };
  flip?: boolean;
}): React.ReactElement {
  const words = (
    <div className="flex flex-col gap-5">
      <p className="text-sm font-semibold text-primary">{t(`marketing.pillars.${name}.eyebrow`)}</p>
      <h2 className="font-heading text-3xl font-semibold tracking-tight">{t(`marketing.pillars.${name}.title`)}</h2>
      <p className="text-lg text-foreground-muted">{t(`marketing.pillars.${name}.body`)}</p>
    </div>
  );
  const points = (
    <ul className="flex flex-col gap-3">
      {POINTS.map((index) => (
        <li key={index} className="flex items-start gap-3">
          <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span>{t(`marketing.pillars.${name}.points.${index}`)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
      {shot === undefined ? (
        // No picture: the points take the picture's side, on a card.
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className={cn(flip && 'lg:order-last')}>{words}</div>
          <div className="rounded bg-surface p-8 shadow-card">{points}</div>
        </div>
      ) : (
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className={cn('flex flex-col gap-6', flip && 'lg:order-last')}>
            {words}
            {points}
          </div>
          <BrowserShot name={shot.name} alt={shot.alt} />
        </div>
      )}
    </section>
  );
}

/** A desk screenshot in a quiet window frame; the dark copy shows in dark mode. */
function BrowserShot({ name, alt, priority = false }: { name: string; alt: string; priority?: boolean }): React.ReactElement {
  return (
    <div className="overflow-hidden rounded bg-surface shadow-[0_20px_50px_-20px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.08)]">
      <div className="flex h-7 items-center gap-1.5 bg-surface-muted px-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
      </div>
      <ThemedImage name={name} alt={alt} width={1600} height={1000} priority={priority} />
    </div>
  );
}

/** A phone screenshot in a rounded body. */
function PhoneShot({ name, alt, priority = false }: { name: string; alt: string; priority?: boolean }): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-[1.6rem] border-[5px] border-foreground/85 bg-surface shadow-[0_20px_40px_-15px_rgb(0_0_0/0.45)]">
      <ThemedImage name={name} alt={alt} width={520} height={1040} priority={priority} />
    </div>
  );
}

function ThemedImage({
  name,
  alt,
  width,
  height,
  priority,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  priority: boolean;
}): React.ReactElement {
  return (
    <>
      <Image
        src={`/marketing/${name}-light.webp`}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        unoptimized
        className="block h-auto w-full dark:hidden"
      />
      <Image
        src={`/marketing/${name}-dark.webp`}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        className="hidden h-auto w-full dark:block"
      />
    </>
  );
}
