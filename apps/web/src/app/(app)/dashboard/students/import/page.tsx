import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { apiFetch, type Students } from '@/lib/api';
import { PageError, PageShell } from '@/components/page-shell';
import { ImportWizard } from './import-wizard';

/**
 * Slice 1.10 — bringing a club's spreadsheet in.
 *
 * The roadmap is blunt about why this exists: "a customer who cannot get their
 * spreadsheet in never becomes a customer". Every club already has a register,
 * in Excel, and typing two hundred children into a web form is not a migration
 * path — it is a reason to stay on the spreadsheet.
 *
 * The screen only offers the levels and the write permission; everything else it
 * needs comes from the file. Read-only members are told rather than shown a
 * wizard whose last button would 403 — and the endpoint refuses them anyway,
 * because hiding a control is never the control.
 */
export default async function ImportStudentsPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let data: Students | null = null;
  let failure: LoadFailure | null = null;

  try {
    // The register, for the level names the mapping step lists and for
    // `canManage`. Both belong to the organization, not to any one student.
    data = await apiFetch<Students>('/students');
  } catch (error) {
    failure = describeLoad(error);
  }

  return (
    <PageShell
      title={t('students.import.title')}
      subtitle={t('students.import.subtitle')}
      back={{ href: '/dashboard/students', label: t('students.backToRegister') }}
    >
      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {data !== null && !data.canManage && (
        <p className="text-sm text-foreground-muted">{t('students.readOnly')}</p>
      )}

      {data !== null && data.canManage && <ImportWizard levels={data.levels} />}
    </PageShell>
  );
}
