import { Check } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { PoolseSport } from '@poolse/rules';
import type { OrganizationMember } from '@/lib/api';
import { FromLink } from '@/components/from-link';
import { FilterSelect } from '@/components/filter-select';
import { PersonAvatar } from '@/components/person-avatar';
import { BirthdayFlag } from '@/components/birthday-flag';
import { SportIcon, sportNameKey } from '@/components/sport-icon';
import { STAFF_ROLES } from '@/lib/roles';
import { timeAgo } from '@/lib/relative-time';

const HEAD = 'whitespace-nowrap px-2 py-2 text-left font-medium';
const CELL = 'px-2 py-2 align-middle';
/** The narrow columns: a mark under a sport or a role. */
const MARK = 'px-1.5 py-2 text-center align-middle';

/**
 * Pessoas as a table — POOLSE-158 (Rui, 04-11-2026).
 *
 * Name, email, the person's sports, one column per staff role, and when the
 * login was last used. **One Desportos column** (Rui, 04-11-2026): the sports a
 * person has, by name, under a header that is the filter itself, its word the
 * select's prompt rather than a label above it. The role columns are **marks, never checkboxes**:
 * the list says what a person is, and the record is where that is changed. A
 * mark is a check glyph with "sim" for a screen reader, so a reader hears
 * "Instrutor, sim"; an empty cell is a dash with "não".
 *
 * **Sports appear only in a multi-sport club**, and their header is
 * the filter. It writes `?sport=` and the API filters, so a page is never
 * shorter than the one before it. Below `md` the table is `.table-stack`; the
 * header row is clipped there, except the filter cell, which un-clips itself
 * as Em dívida's select-all does. A card shows only the marks that are set,
 * because twelve "não" lines bury the two that matter.
 */
export async function StaffTable({
  members,
  sports,
  sport,
}: {
  members: OrganizationMember[];
  /** The club's sports, when it has more than one; empty otherwise. */
  sports: PoolseSport[];
  /** The sport the list is filtered to, or empty for every sport. */
  sport: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const multi = sports.length > 0;
  const roles = STAFF_ROLES;

  // On a phone the clipped header is reopened only to keep the filter on screen.
  // The `!` forms are needed there: `.table-stack tr` / `td` set `display` with a
  // more specific selector than a plain utility.
  const unclip = multi
    ? 'max-md:!static max-md:!block max-md:!h-auto max-md:!w-auto max-md:!overflow-visible max-md:![clip:auto] max-md:!whitespace-normal'
    : '';

  return (
    <div className="relative overflow-x-auto">
      <table className="table-stack w-full border-collapse text-sm">
        <caption className="sr-only">{t('staff.table.caption')}</caption>
        <thead className={unclip}>
          <tr className="border-b border-border text-foreground-muted max-md:block max-md:border-0">
            <th scope="col" rowSpan={2} className={`${HEAD} max-md:hidden`}>
              {t('staff.table.name')}
            </th>
            <th scope="col" rowSpan={2} className={`${HEAD} max-md:hidden`}>
              {t('staff.table.email')}
            </th>
            {multi && (
              <th scope="col" rowSpan={2} className={`${HEAD} align-bottom max-md:block max-md:px-0 max-md:pb-3`}>
                <FilterSelect
                  name="sport"
                  label={t('staff.table.sports')}
                  hideLabel
                  value={sport}
                  anyLabel={t('staff.table.sportsPrompt')}
                  options={sports.map((one) => ({ value: one, label: t(sportNameKey(one)) }))}
                />
              </th>
            )}
            <th scope="colgroup" colSpan={roles.length} className={`${HEAD} max-md:hidden`}>
              {t('staff.table.roles')}
            </th>
            <th scope="col" rowSpan={2} className={`${HEAD} max-md:hidden`}>
              {t('staff.table.access')}
            </th>
          </tr>
          <tr className="border-b border-border text-foreground-muted max-md:!hidden">
            {roles.map((role) => (
              <th key={role} scope="col" className="whitespace-nowrap px-1.5 py-2 text-center text-xs font-normal">
                {t(`roles.${role}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.length === 0 && (
            <tr>
              <td colSpan={2 + (multi ? 1 : 0) + roles.length + 1} className={`${CELL} py-6 text-center text-foreground-muted`}>
                {t('staff.table.noneForSport')}
              </td>
            </tr>
          )}
          {members.map((member) => (
            <tr key={member.membershipId} className="border-b border-border/60 last:border-0">
              <th scope="row" className={`${CELL} text-left font-normal`}>
                <span className="flex min-w-0 items-center gap-3">
                  <PersonAvatar
                    id={member.membershipId}
                    name={member.shortName ?? member.email ?? '?'}
                    photoUrl={member.avatarUrl}
                  />
                  {/* The record is where a name is corrected — POOLSE-39. */}
                  <FromLink
                    href={`/dashboard/facilities/staff/${member.membershipId}`}
                    className="truncate rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {member.shortName ?? t('account.noName')}
                  </FromLink>
                  <BirthdayFlag birthDate={member.birthDate} />
                </span>
              </th>
              <td data-label={t('staff.table.email')} className={`${CELL} [overflow-wrap:anywhere] md:min-w-36`}>
                {member.email ?? <span className="text-foreground-muted">—</span>}
              </td>
              {multi && (
                <td data-label={t('staff.table.sports')} className={CELL}>
                  {(member.sports ?? []).length === 0 ? (
                    <span className="text-foreground-muted">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-x-3 gap-y-1 max-md:justify-end">
                      {(member.sports ?? []).map((one) => (
                        <span key={one} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <SportIcon sport={one} className="size-4" />
                          {t(sportNameKey(one))}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              )}
              {roles.map((role) => (
                <Mark
                  key={role}
                  label={t(`roles.${role}`)}
                  on={member.roles.includes(role)}
                  yes={t('staff.table.yes')}
                  no={t('staff.table.no')}
                />
              ))}
              <td data-label={t('staff.table.access')} className={CELL}>
                <span className={member.status === 'invited' ? 'text-warning' : 'text-foreground-muted'}>
                  {access(member, locale, t)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A read-only mark: a check and "sim", or a dash and "não" (hidden on a phone's card). */
function Mark({
  label,
  on,
  yes,
  no,
}: {
  label: string;
  on: boolean;
  yes: string;
  no: string;
}): React.ReactElement {
  return (
    <td data-label={label} className={`${MARK} ${on ? '' : 'max-md:!hidden'}`}>
      {on ? (
        <>
          <Check aria-hidden className="inline size-4 text-primary" />
          <span className="sr-only">{yes}</span>
        </>
      ) : (
        <>
          <span aria-hidden className="text-foreground-muted">
            —
          </span>
          <span className="sr-only">{no}</span>
        </>
      )}
    </td>
  );
}

/** What *Acesso* says: a pending invitation, no login, never back, or when they last came. */
function access(
  member: OrganizationMember,
  locale: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
): string {
  if (member.status === 'invited') return t('people.pending');
  if (member.appUserId === null) return t('staff.table.noLogin');
  const ago = timeAgo(member.lastSeenAt ?? null, locale);
  return ago === null ? t('staff.table.neverSeen') : t('staff.table.seen', { ago });
}
