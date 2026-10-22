import { Fragment } from 'react';
import { FromLink } from '@/components/from-link';
import { getTranslations } from 'next-intl/server';
import type { Dashboard } from '@/lib/api';
import { renderWidget } from './widgets';

/**
 * The dashboard as bands — POOLSE-66, slice 2a.
 *
 * **A union of the reader's roles, in the payload's order.** The server decides
 * which bands exist and which cards are in them; this renders what it is given
 * and makes no judgement of its own. In particular a band the reader holds no
 * role in is *absent from the payload*, so there is nothing here to hide — which
 * is the whole reason the gating is server-side.
 *
 * **The heading is the point of the grouping.** An owner who also teaches gets a
 * management band and an operational one, and without names the page reads as an
 * arbitrary pile of cards. It is shown even when there is only one band: a
 * reader who sees "Operação" learns that there is somewhere else the rest of the
 * product lives.
 *
 * Three columns at `lg`, one below it, with each card spanning what the registry
 * gave it. The sizes are the server's opinion about weight, not a layout — a
 * narrow screen ignores them entirely and stacks.
 *
 * **Everything is resolved before anything is returned.** The cards are async
 * components, so mapping them inside the JSX would hand React an array of
 * promises; `Promise.all` up front also means one slow card cannot stagger the
 * band it is in.
 */
export async function Bands({ dashboard }: { dashboard: Dashboard }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const family = dashboard.family;
  const chosen = family?.children.find((child) => child.id === family.selectedId);

  const bands = await Promise.all(
    dashboard.bands.map(async (band) => ({
      id: band.id,
      cards: await Promise.all(
        band.widgets.map(async (widget) => ({
          id: widget.id,
          element: await renderWidget(widget, dashboard.scope, dashboard.family),
        })),
      ),
    })),
  );

  return (
    <>
      {bands.map((band) => (
        <section key={band.id} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t(`dashboard.band.${band.id}`)}
            {band.id === 'personal' && chosen !== undefined && <> · {chosen.name}</>}
          </h2>

          {/*
            Whose cards these are — slice 5. Plain links, so the choice lives in
            the address (`?child=`, Rui's call) and Back works; offered only
            when there is a choice. The current one says so in words as well
            as weight.
          */}
          {band.id === 'personal' && family !== null && family.children.length > 1 && (
            <nav aria-label={t('family.picker')} className="flex flex-wrap gap-2">
              {family.children.map((child) => {
                const current = child.id === family.selectedId;
                return (
                  <FromLink
                    key={child.id}
                    href={`/dashboard?child=${child.id}`}
                    aria-current={current ? 'page' : undefined}
                    className={
                      current
                        ? 'inline-flex h-control items-center justify-center rounded border border-primary bg-primary/10 px-4 text-control font-medium text-primary'
                        : 'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
                    }
                  >
                    {child.self ? t('family.yourselfShort', { name: child.name }) : child.name}
                  </FromLink>
                );
              })}
            </nav>
          )}

          <div className="grid grid-cols-1 gap-page-gap lg:grid-cols-3">
            {band.cards.map((card) => (
              <Fragment key={card.id}>{card.element}</Fragment>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
