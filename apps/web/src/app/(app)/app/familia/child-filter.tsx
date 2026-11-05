import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AppChild } from '@/lib/api';
import { LinkBusy } from '@/components/link-busy';
import { cn } from '@/lib/utils';

/**
 * Which child — POOLSE-90's filter, shared by *Início* and *Aulas* since
 * POOLSE-136 (child-first, POOLSE-127). `?child=`, a stranger's id is the
 * API's 404. Shown only to a guardian of more than one child.
 */
export async function ChildFilter({
  base,
  children,
  chosen,
}: {
  base: string;
  children: Pick<AppChild, 'id' | 'name'>[];
  chosen: string | undefined;
}): Promise<React.ReactElement | null> {
  if (children.length < 2) return null;
  const t = await getTranslations();
  return (
    <nav aria-label={t('app.family.childFilter')} className="flex flex-wrap gap-2">
      {[{ id: undefined, name: t('app.family.everyone') }, ...children].map((one) => {
        const current = one.id === chosen;
        return (
          <Link
            key={one.id ?? 'all'}
            href={one.id === undefined ? base : `${base}?child=${one.id}`}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'inline-flex h-control items-center justify-center rounded-full border px-4 text-control',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              current ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface',
            )}
          >
            {one.name}
            <LinkBusy />
          </Link>
        );
      })}
    </nav>
  );
}
