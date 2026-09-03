'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { PartnerContact } from '@/lib/api';
import { TextField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { addContactAction, removeContactAction } from '../../[facilityId]/partners.actions';

/**
 * Who to ring — POOLSE-47, criterion 9.
 *
 * Several per partner, because a school has a head of department who agrees the
 * timetable and an office that pays the invoice, and ringing the wrong one
 * wastes a morning. The role is free text rather than a list: "Coordenadora de
 * Educação Física" is what the school calls her, and an enum would make the club
 * choose between four wrong words.
 *
 * **A telephone number alone is enough.** This is deliberately *not* the
 * guardian rule — a guardian needs a NIF or an email because they are
 * deduplicated against the register. A partner contact is never merged with
 * anybody, so a mobile number is a perfectly good way to reach them.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'inline-flex h-control items-center gap-2 rounded border border-border px-3 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function PartnerContacts({
  partnerId,
  contacts,
  canManage,
}: {
  partnerId: string;
  contacts: PartnerContact[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, add, pending] = useSavedAction(addContactAction, INITIAL);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('partners.contacts')}
        </h2>

        {canManage && (
          <button type="button" onClick={() => setOpen((was) => !was)} className={BUTTON_QUIET}>
            <Plus className="size-4" aria-hidden />
            {t('partners.addContact')}
          </button>
        )}
      </div>

      {open && canManage && (
        <form
          action={add}
          className="flex flex-col gap-4 rounded border border-border bg-surface-muted p-4"
        >
          <input type="hidden" name="partnerId" value={partnerId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="name"
              label={t('partners.contactName')}
              required
              maxLength={160}
              error={state.fields?.['name'] ? t(state.fields['name']) : undefined}
            />
            <TextField
              name="role"
              label={t('partners.contactRole')}
              maxLength={160}
              hint={t('partners.contactRoleHint')}
            />
            <TextField
              name="email"
              label={t('partners.email')}
              type="email"
              maxLength={254}
              error={state.fields?.['email'] ? t(state.fields['email']) : undefined}
            />
            <TextField name="phone" label={t('partners.phone')} type="tel" maxLength={40} />
          </div>

          {/*
            Said before it is enforced, so the rule is a instruction rather than
            a refusal somebody meets after typing. The API enforces it too — this
            is the explanation, never the control.
          */}
          <p className="text-sm text-foreground-muted">{t('partners.contactReachable')}</p>

          {state.errorKey !== undefined && (
            <p className="text-sm text-danger">{t(state.errorKey)}</p>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={BUTTON}>
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={BUTTON_QUIET}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {contacts.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('partners.noContacts')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="font-medium">{contact.name}</p>
                {contact.role !== null && (
                  <p className="text-sm text-foreground-muted">{contact.role}</p>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm">
                {/*
                  Real links. Somebody reading this on a phone beside the pool is
                  the person who needs to ring the school, and making them
                  retype the number is the difference between a screen that helps
                  and a screen that displays.
                */}
                {contact.email !== null && (
                  <a
                    href={`mailto:${contact.email}`}
                    className="rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {contact.email}
                  </a>
                )}
                {contact.phone !== null && (
                  <a
                    href={`tel:${contact.phone}`}
                    className="rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {contact.phone}
                  </a>
                )}

                {canManage && (
                  <RemoveContact partnerId={partnerId} contactId={contact.id} name={contact.name} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RemoveContact({
  partnerId,
  contactId,
  name,
}: {
  partnerId: string;
  contactId: string;
  name: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, remove, pending] = useSavedAction(removeContactAction, INITIAL);

  return (
    <form action={remove}>
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name="contactId" value={contactId} />
      <button
        type="submit"
        disabled={pending}
        // Named, so the button is not "remove" nine times over to somebody
        // moving through the list with a screen reader.
        aria-label={t('partners.removeContactNamed', { name })}
        className="rounded p-1 text-foreground-muted hover:text-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </form>
  );
}
