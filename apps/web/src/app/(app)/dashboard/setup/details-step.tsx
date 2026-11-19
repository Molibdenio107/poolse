import { getTranslations } from 'next-intl/server';
import { requiredDetails } from '@poolse/rules';
import { PageShell } from '@/components/page-shell';
import { ConfirmDetailsForm } from '@/components/confirm-details/confirm-details-form';
import { apiFetch, type Me, type StaffDetails } from '@/lib/api';
import { DetailsNext } from './step-controls';
import { SetupHeader } from './stepper';
import { WIZARD_STEPS, type WizardState } from './steps';

/** Step 1's form, submitted by the wizard's own bottom bar. */
export const DETAILS_FORM = 'setup-details';

const CARD = 'flex flex-col gap-4 border-t border-border px-5 py-6 sm:px-8';
const INNER = 'mx-auto flex w-full max-w-2xl flex-col gap-4';

/**
 * 1 · Os seus dados: the details form of *Confirmar os seus dados*, with the
 * optional date of birth of *O meu perfil* (Rui, 19-11-2026). Its own button is
 * *Seguinte*, in the wizard's bar: it saves through the profile and opens *Clube*.
 */
export async function DetailsStep({ me }: { me: Me }): Promise<React.ReactElement> {
  const membership = me.memberships[0]!;
  const required = requiredDetails(membership.roles, { adultPathStudent: true });
  // An Owner who also teaches gives the payroll details too, prefilled from their record.
  const known = required.includes('taxNumber')
    ? await apiFetch<StaffDetails>(`/staff/${membership.membershipId}/details`).catch(() => null)
    : null;
  return (
    <section className={CARD}>
      <div className={INNER}>
        <ConfirmDetailsForm
          required={required}
          missing={me.detailsMissing ?? []}
          initial={{
            firstName: me.user.firstName ?? '',
            lastName: me.user.lastName ?? '',
            contactPhone: me.user.contactPhone ?? '',
            taxNumber: known?.taxNumber ?? '',
            address: known?.address ?? '',
            postalCode: known?.postalCode ?? '',
            locality: known?.locality ?? '',
          }}
          taxNumberLocked={(known?.taxNumber ?? null) !== null}
          staffUnreadable={required.includes('taxNumber') && known === null}
          children={null}
          contact={null}
          confirmLabelKey="setup.next"
          birthDate={me.user.birthDate ?? ''}
          then="/dashboard/setup?step=club"
          formId={DETAILS_FORM}
        />
      </div>
    </section>
  );
}

/**
 * The only wizard (Rui, 19-11-2026): an Owner whose club has a setup and who
 * still owes a detail meets its step 1 in place of any page — never the old
 * *Confirmar os seus dados* screen, wherever they arrive. Drawn by the layout
 * inside its shell (menus hidden, the account menu kept for signing out), so
 * no address gets round it.
 */
export async function SetupDetailsGate({ me, wizard }: { me: Me; wizard: WizardState }): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <PageShell title={t('setup.title')}>
      <SetupHeader
        step="details"
        behind={wizard.step === null ? WIZARD_STEPS.length : WIZARD_STEPS.indexOf(wizard.step)}
        footer={<DetailsNext formId={DETAILS_FORM} />}
      >
        <DetailsStep me={me} />
      </SetupHeader>
    </PageShell>
  );
}
