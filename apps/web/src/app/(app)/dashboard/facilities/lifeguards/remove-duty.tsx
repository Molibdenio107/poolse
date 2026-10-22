'use client';

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { removeDutyAction } from './roster.actions';

const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const DANGER =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-danger/50 px-4 text-control text-danger hover:bg-danger/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export interface DutyView {
  id: string;
  name: string;
  /** "segunda-feira, 16 de novembro de 2026, das 08:00 às 14:00" — composed by the grid through `roster.dutyWhen`. */
  when: string;
  licensed: boolean;
  fromPeriod: boolean;
}

/**
 * One duty, opened from its block on the week's grid — POOLSE-96.
 *
 * What the block cannot fit (the whole name, the hours, the licence warning in
 * words, whether a vigilance period wrote it) and, for owner and admin, the way
 * to take it off the roster. One dialog rather than a details popover with a
 * confirmation stacked on it: the sentence already names what is removed, so
 * the button can be the confirmation. The duty leaves the roster and stays in
 * the history.
 */
export function DutyDialog({
  duty,
  canManage,
  onClose,
}: {
  duty: DutyView | null;
  canManage: boolean;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const close = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={duty !== null}
      onClose={onClose}
      title={duty?.name ?? ''}
      description={duty?.when}
      closeLabel={t('common.close')}
      initialFocus={close}
    >
      {duty !== null && (
        <div className="flex flex-col gap-4 text-sm">
          {!duty.licensed && (
            <p className="flex items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              {t('roster.notLicensed')}
            </p>
          )}
          {duty.fromPeriod && <p className="text-foreground-muted">{t('roster.fromPeriodLong')}</p>}
          {canManage && <p className="text-foreground-muted">{t('roster.removeKeepsHistory')}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button ref={close} type="button" onClick={onClose} className={QUIET}>
              {t('common.close')}
            </button>
            {canManage && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await removeDutyAction(duty.id);
                    onClose();
                    if (result.ok) {
                      toast.show('success', t('roster.removed'));
                      router.refresh();
                    } else {
                      toast.show('danger', t((result.errorKey ?? 'roster.error.removeFailed') as never));
                    }
                  })
                }
                className={DANGER}
              >
                {pending ? t('common.working') : t('roster.removeDuty')}
              </button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
