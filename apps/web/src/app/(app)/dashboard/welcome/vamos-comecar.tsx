import { getTranslations } from 'next-intl/server';
import { ArrowRight, Check, Circle } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { StartTourButton } from '@/components/tour/start-tour-button';
import { cn } from '@/lib/utils';
import { ChecklistToggle } from './checklist-toggle';

export type ChecklistKey =
  | 'club_details'
  | 'places'
  | 'team'
  | 'students'
  | 'turmas'
  | 'prices'
  | 'public_form'
  | 'tour';

export interface ChecklistAnswer {
  checklist: { items: { key: ChecklistKey; done: boolean }[]; dismissed: boolean } | null;
  canDismiss: boolean;
}

/**
 * *Vamos começar* — POOLSE-229 (Rui, 19-11-2026).
 *
 * What a club still needs before its first month, each line ticked by the API
 * from the club's own data and linked to the screen where it is done. Open
 * lines first. A ticked line says *Feito* in words beside its tick, so colour is
 * never the only sign. Gone when everything is done, or when the Owner
 * dismisses it; an Admin reads it and cannot dismiss it. The public form's line
 * is the Owner's to open (`public_registration_open`), so an Admin is told so
 * instead of being linked to a switch that would refuse them.
 */
export async function VamosComecar({
  answer,
  siteHref,
  isOwner,
}: {
  answer: ChecklistAnswer;
  /** The first site's page, or Instalações with several or none. */
  siteHref: string;
  isOwner: boolean;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const list = answer.checklist;
  if (list === null || list.dismissed) return null;
  const total = list.items.length;
  const finished = list.items.filter((item) => item.done).length;
  if (total === 0 || finished === total) return null;

  const href: Record<ChecklistKey, string | null> = {
    club_details: siteHref,
    places: siteHref,
    team: '/dashboard/facilities/staff',
    students: '/dashboard/students/import',
    turmas: '/dashboard/classes',
    // `fee_plan` is per site: its Preços tab, or the list when there is no one site.
    prices: siteHref === '/dashboard/facilities' ? siteHref : `${siteHref}?tab=prices`,
    public_form: isOwner ? '/dashboard/students/pedidos' : null,
    tour: null,
  };
  const ordered = [...list.items.filter((item) => !item.done), ...list.items.filter((item) => item.done)];

  return (
    <section aria-labelledby="vamos-comecar" className="flex flex-col gap-3 rounded border border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h2 id="vamos-comecar" className="text-base font-semibold">
            {t('checklist.title')}
          </h2>
          <p className="text-sm text-foreground-muted">{t('checklist.progress', { done: finished, total })}</p>
        </div>
        {answer.canDismiss && <ChecklistToggle dismiss />}
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {ordered.map((item) => {
          const target = href[item.key];
          const label = (
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn('font-medium', item.done && 'text-foreground-muted')}>
                {t(`checklist.item.${item.key}.title`)}
              </span>
              {!item.done && (
                <span className="text-sm text-foreground-muted">
                  {item.key === 'public_form' && !isOwner
                    ? t('checklist.ownerOnly')
                    : t(`checklist.item.${item.key}.hint`)}
                </span>
              )}
            </span>
          );
          const mark = item.done ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-sm text-success">
              <Check className="size-4" aria-hidden />
              {t('checklist.done')}
            </span>
          ) : (
            <Circle className="mt-0.5 size-4 shrink-0 text-foreground-muted" aria-hidden />
          );

          return (
            <li key={item.key} className="flex items-start gap-3 py-3 first:pt-1 last:pb-1">
              {item.done ? null : mark}
              {item.key === 'tour' && !item.done ? (
                <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                  {label}
                  <StartTourButton />
                </span>
              ) : target !== null && !item.done ? (
                <FromLink
                  href={target}
                  className="group flex min-w-0 flex-1 items-start gap-2 rounded hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {label}
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-foreground-muted transition-transform group-hover:text-primary motion-safe:group-hover:translate-x-1"
                    aria-hidden
                  />
                </FromLink>
              ) : (
                label
              )}
              {item.done ? mark : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
