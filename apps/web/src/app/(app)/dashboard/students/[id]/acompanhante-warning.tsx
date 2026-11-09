'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/confirm-action';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { removeAcompanhanteAction } from '../majority.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Maior de idade com acompanhante* — POOLSE-207 rule 3 (Rui, 09-11-2026). An
 * adult with an acompanhante is treated as a minor in the app, which is right for
 * a *maior acompanhado* and wrong for anybody else, so the record says it in
 * words. It warns and blocks nothing; *Retirar acompanhante* asks first.
 */
export function AcompanhanteWarning({
  studentId,
  links,
}: {
  studentId: string;
  links: { linkId: string; name: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeAcompanhanteAction, INITIAL);
  return (
    <section className="flex flex-col gap-3 rounded border border-warning bg-warning/[0.08] p-4">
      <div className="flex flex-col items-start gap-1">
        <Badge tone="pending">{t('majority.warning.badge')}</Badge>
        <p className="text-sm">{t('majority.warning.body')}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.linkId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{link.name}</span>
            <ConfirmAction
              action={action}
              pending={pending}
              fields={{ studentId, linkId: link.linkId }}
              title={t('majority.warning.removeTitle')}
              message={t('majority.warning.removeMessage', { name: link.name })}
              confirmLabel={t('majority.warning.remove')}
              trigger={t('majority.warning.remove')}
              triggerClassName="inline-flex h-control items-center justify-center rounded-sm border border-border-strong px-4 text-control hover:bg-surface-muted"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
