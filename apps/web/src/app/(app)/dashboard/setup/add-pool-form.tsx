'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { PoolForm } from '../facilities/pool-form';

/**
 * *Adicionar tanque* inside the setup's step 2 — Rui, 19-11-2026: the same form
 * as Instalações, every measurement included, folded until the Owner opens it,
 * and saved without leaving the setup. The new tank is listed above at once;
 * the panel folds and the form starts empty for the next one (a new `key`).
 * A native `<details>`, so `DetailsAnimator` moves it and a screen reader
 * hears a disclosure.
 */
export function AddPoolForm({
  organizationId,
  facilityId,
}: {
  organizationId: string;
  facilityId: string;
}): React.ReactElement {
  const t = useTranslations();
  const panel = useRef<HTMLDetailsElement>(null);
  const [round, setRound] = useState(0);

  const created = useCallback(() => {
    if (panel.current !== null) panel.current.open = false;
    setRound((n) => n + 1);
  }, []);

  return (
    <details ref={panel} className="group flex flex-col">
      <summary className={buttonClass('primary', 'w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
        <Plus className="size-4" aria-hidden />
        {t('setup.step.places.addPool')}
      </summary>
      <div className="mt-4 flex flex-col gap-3 rounded border border-border p-4">
        <p className="text-sm text-foreground-muted">{t('setup.step.places.poolHint')}</p>
        <PoolForm
          key={round}
          organizationId={organizationId}
          facilityId={facilityId}
          mode="create"
          stay
          onCreated={created}
        />
      </div>
    </details>
  );
}
