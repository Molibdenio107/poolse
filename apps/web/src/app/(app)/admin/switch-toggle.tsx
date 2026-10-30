'use client';

import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { PlatformSwitchName } from '@/lib/api';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { formatStamp } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { setSwitchAction } from './actions';

const INITIAL: FormState = { ok: false };

/** One switch: its state in words, the key's, and one button to flip it. */
export function SwitchToggle({
  name,
  enabled,
  changedAt,
  keyConfigured,
}: {
  name: PlatformSwitchName;
  enabled: boolean;
  changedAt: string | null;
  keyConfigured: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction(setSwitchAction, INITIAL);

  return (
    <form action={dispatch} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{t(`admin.switches.name.${name}`)}</p>
        <p className="text-sm text-foreground-muted">{t(`admin.switches.covers.${name}`)}</p>
        <p className="text-sm">
          <span className={cn('font-medium', enabled ? 'text-success' : 'text-foreground-muted')}>
            {t(enabled ? 'admin.switches.on' : 'admin.switches.off')}
          </span>
          {changedAt !== null && (
            <span className="text-foreground-muted"> · {t('admin.switches.changedAt', { when: formatStamp(changedAt) })}</span>
          )}
        </p>
        <p className={cn('text-sm', keyConfigured ? 'text-foreground-muted' : 'text-warning')}>
          {t(keyConfigured ? 'admin.switches.keyPresent' : 'admin.switches.keyMissing')}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className={cn(
          'inline-flex h-control shrink-0 items-center justify-center self-start rounded px-4 text-control font-medium disabled:opacity-60',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 outline-primary',
          enabled
            ? 'border border-border bg-surface hover:bg-surface-muted'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        {t(enabled ? 'admin.switches.turnOff' : 'admin.switches.turnOn')}
      </button>
    </form>
  );
}
