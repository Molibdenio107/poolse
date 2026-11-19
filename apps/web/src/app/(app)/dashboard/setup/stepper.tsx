import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Building2, Check, FileSpreadsheet, Users, Waves, type LucideIcon } from 'lucide-react';
import { LinkBusy } from '@/components/link-busy';
import { cn } from '@/lib/utils';
import { WaterBanner } from '../water-banner';
import { LogoLockIn } from '@/components/logo-lock-in';
import { SETUP_STEPS, type SetupStep } from './steps';

/** Each step's picture, used on the banner and nowhere it would be the only sign. */
export const STEP_ICON: Record<SetupStep, LucideIcon> = {
  club: Building2,
  places: Waves,
  team: Users,
  import: FileSpreadsheet,
};

/**
 * The setup's head — Rui, 19-11-2026: "prettier, with the Poolse feeling". The
 * water banner of the creation screen with this step's picture, then the four
 * steps as numbered circles on one line: a tick and the primary fill for those
 * behind, the current one filled and ringed, the rest muted. Every step is a
 * link, so the Owner can go back to one or look ahead; the words under each
 * circle carry the meaning, never the colour alone.
 */
export async function SetupHeader({
  step,
  behind,
  children,
  footer,
}: {
  step: SetupStep;
  behind: number;
  /** The step's own sections, inside this same card (Rui, 19-11-2026). */
  children?: React.ReactNode;
  /** Voltar and Seguinte, along the card's bottom edge. */
  footer?: React.ReactNode;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const Icon = STEP_ICON[step];
  const at = SETUP_STEPS.indexOf(step);

  return (
    <section className="overflow-hidden rounded bg-surface shadow-card ring-2 ring-primary/40">
      {/* The Poolse mark, as on the creation screen and Início (Rui, 19-11-2026). */}
      <WaterBanner tall>
        <LogoLockIn />
      </WaterBanner>

      <div className="flex flex-col gap-6 px-4 pb-6 pt-2 sm:px-8">
        <ol aria-label={t('setup.stepsLabel')} className="grid grid-cols-4">
          {SETUP_STEPS.map((key, index) => {
            const done = index < behind && index !== at;
            const current = index === at;
            return (
              <li key={key} className="relative flex flex-col items-center gap-2 text-center">
                {/* The line to the next circle, behind it. */}
                {index < SETUP_STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-1/2 top-4 h-0.5 w-full',
                      index < behind ? 'bg-primary' : 'bg-border',
                    )}
                  />
                )}
                <Link
                  href={`/dashboard/setup?step=${key}`}
                  aria-current={current ? 'step' : undefined}
                  className="group relative flex flex-col items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span
                    className={cn(
                      'inline-flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-transform motion-safe:group-hover:scale-110',
                      done
                        ? 'bg-primary text-primary-foreground'
                        : current
                          ? 'bg-primary text-primary-foreground ring-4 ring-primary/25'
                          : 'bg-surface-muted text-foreground-muted ring-1 ring-border',
                    )}
                  >
                    {done ? <Check className="size-4" strokeWidth={3} aria-hidden /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      'max-w-[9rem] text-xs leading-tight sm:text-sm',
                      current ? 'font-semibold text-foreground' : 'text-foreground-muted',
                    )}
                  >
                    {t(`setup.step.${key}.short`)}
                    {done && <span className="sr-only"> ({t('checklist.done')})</span>}
                  </span>
                  <LinkBusy />
                </Link>
              </li>
            );
          })}
        </ol>

        <div className="onboard-rise flex flex-col items-center gap-1 text-center" style={{ '--i': 1 } as React.CSSProperties}>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            {t('setup.progress', { n: at + 1, total: SETUP_STEPS.length })}
          </p>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Icon className="size-4" />
            </span>
            {t(`setup.step.${step}.title`)}
          </h2>
          <p className="max-w-xl text-sm text-foreground-muted">{t(`setup.step.${step}.hint`)}</p>
        </div>
      </div>
      {children}
      {footer}
    </section>
  );
}
