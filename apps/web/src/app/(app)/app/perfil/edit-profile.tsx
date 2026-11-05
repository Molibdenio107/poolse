'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import type { Me } from '@/lib/api';
import { ProfileForm } from '../../dashboard/profile/profile-form';

/**
 * *Editar dados* — POOLSE-176. *Perfil* reads; this one button opens the same
 * `ProfileForm` the desk uses, with the same save, as a bottom sheet (centred on
 * a laptop). A save that worked closes the sheet, and the card behind it
 * re-reads through the form's own `router.refresh()`.
 */
export function EditProfile({ me, photo }: { me: Me; photo: React.ReactNode }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-control w-full items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('app.profile.edit')}
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={t('app.profile.edit')}
        closeLabel={t('common.close')}
        placement="sheet"
        className="app-form"
      >
        <div className="flex flex-col gap-4">
          <div className="flex justify-center">{photo}</div>
          <ProfileForm me={me} withPreferences={false} onSaved={close} />
          <button
            type="button"
            onClick={close}
            className="inline-flex h-control items-center justify-center rounded-sm px-4 text-control text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
