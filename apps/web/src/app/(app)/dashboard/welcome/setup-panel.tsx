import { getTranslations } from 'next-intl/server';
import { ArrowRight, Check, Clock } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { cn } from '@/lib/utils';
import { WaterBanner } from '../water-banner';
import { LogoLockIn } from '@/components/logo-lock-in';
import { SETUP_STEPS, type WizardState } from '../setup/steps';
import { VamosComecar, type ChecklistAnswer } from './vamos-comecar';

/**
 * Início's own setup page — Rui, 19-11-2026: "the wizard needs to have its own
 * highlighted page", apart from *Por onde começar*, because the two together
 * did not combine.
 *
 * While the Owner's setup steps are under way it shows only them: where the
 * Owner is, what was left for later, and *Continuar*. Once they are finished,
 * or for a club that never had them (the pilot), it holds *Vamos começar*, the
 * checklist that ticks itself from the club's data. The page that offers it
 * decides whether there is anything to show (`hasSetupPage`).
 */
export async function SetupPanel({
  wizard,
  checklist,
  siteHref,
  isOwner,
}: {
  /** An Owner's setup under way, or null. */
  wizard: WizardState | null;
  checklist: ChecklistAnswer | null;
  siteHref: string;
  isOwner: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const step = wizard?.step ?? null;
  const active = wizard !== null && step !== null ? { ...wizard, step } : null;

  return (
    <section
      aria-labelledby="setup-panel-title"
      className="overflow-hidden rounded bg-surface shadow-card ring-2 ring-primary/50"
    >
      {/* The Poolse mark, as on the creation screen and the setup itself (Rui, 19-11-2026). */}
      <WaterBanner tall>
        <LogoLockIn />
      </WaterBanner>

      <div className="flex flex-col gap-5 p-5 sm:p-8">
        {active !== null ? (
          <WizardProgress wizard={active} t={t} />
        ) : (
          <>
            <h2 id="setup-panel-title" className="sr-only">
              {t('checklist.title')}
            </h2>
            {checklist !== null && <VamosComecar answer={checklist} siteHref={siteHref} isOwner={isOwner} />}
          </>
        )}
      </div>
    </section>
  );
}

function WizardProgress({
  wizard,
  t,
}: {
  wizard: WizardState & { step: NonNullable<WizardState['step']> };
  t: Awaited<ReturnType<typeof getTranslations>>;
}): React.ReactElement {
  const at = SETUP_STEPS.indexOf(wizard.step);

  return (
    <>
      <div className="onboard-rise flex flex-col gap-1 text-center" style={{ '--i': 0 } as React.CSSProperties}>
        <h2 id="setup-panel-title" className="text-xl font-semibold">
          {t('setup.title')}
        </h2>
        <p className="text-sm text-foreground-muted">
          {t('setup.progress', { n: at + 1, total: SETUP_STEPS.length })} · {t('setup.panelHint')}
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {SETUP_STEPS.map((key, index) => {
          const current = key === wizard.step;
          const skipped = wizard.skipped.includes(key) && !current;
          const done = index < at && !skipped;
          return (
            <li
              key={key}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'onboard-rise flex items-start gap-3 rounded p-3',
                current ? 'bg-primary/10 ring-1 ring-primary/40' : 'bg-surface-muted/60',
              )}
              style={{ '--i': index + 1 } as React.CSSProperties}
            >
              <span
                aria-hidden
                className={cn(
                  'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  done
                    ? 'bg-primary text-primary-foreground'
                    : current
                      ? 'bg-primary/20 text-primary'
                      : 'bg-surface text-foreground-muted',
                )}
              >
                {done ? <Check className="size-4" strokeWidth={3} /> : skipped ? <Clock className="size-4" /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn('font-medium', !current && !skipped && !done && 'text-foreground-muted')}>
                  {t(`setup.step.${key}.title`)}
                </span>
                <span className="text-sm text-foreground-muted">
                  {done
                    ? t('checklist.done')
                    : skipped
                      ? t('setup.skippedLong')
                      : current
                        ? t(`setup.step.${key}.hint`)
                        : t('setup.toCome')}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col items-center gap-1.5">
        <FromLink
          href={`/dashboard/setup?step=${wizard.step}`}
          className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {at === 0 && wizard.skipped.length === 0 ? t('setup.begin') : t('setup.resume')}
          <ArrowRight className="size-4" aria-hidden />
        </FromLink>
        <p className="text-sm text-foreground-muted">{t('setup.resumeHint')}</p>
      </div>
    </>
  );
}
