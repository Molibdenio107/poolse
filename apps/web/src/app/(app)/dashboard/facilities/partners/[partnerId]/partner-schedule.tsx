import { getTranslations } from 'next-intl/server';
import type { PartnerBooking } from '@/lib/api';

/**
 * When this partner is in the water — POOLSE-47, criterion 9.
 *
 * **Read-only, and deliberately.** The grid is where hours are moved
 * (POOLSE-49 draws it, POOLSE-50 lets it be dragged); this is the same facts
 * seen from the partnership's side, so that "what did we sell ES D. Dinis" can
 * be answered without reading a week grid across six lanes. Two places to edit
 * one booking would be two places for it to disagree.
 *
 * **Empty on the day this ships, and it says so rather than disappearing.**
 * Nothing can put a group on the grid until POOLSE-50, so every partner's panel
 * reads "no hours booked yet" — which is the truth. A panel that vanished when
 * empty would make the operator wonder whether the page had finished loading.
 *
 * A server component: it renders what it is given and has nothing to hold.
 */

/** `09:00` plus 45 minutes is `09:45`. Wall clock, at the facility. */
function endTime(startTime: string, durationMinutes: number): string {
  const [h = '0', m = '0'] = startTime.split(':');
  const total = Number(h) * 60 + Number(m) + durationMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export async function PartnerSchedule({
  bookings,
}: {
  bookings: PartnerBooking[];
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('partners.schedule')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">{t('partners.scheduleReadOnly')}</p>
      </div>

      {bookings.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('partners.noBookings')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th scope="col" className="py-2 pr-4 font-medium">{t('partners.day')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('partners.hours')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('partners.groupName')}</th>
                <th scope="col" className="py-2 font-medium">{t('partners.lanes')}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td className="py-2 pr-4">
                    {/*
                      `week.*` is the catalogue the turma screens already use,
                      keyed by ISO weekday. A second list of day names here would
                      be a second place for Quarta to be spelled differently.
                    */}
                    {t(`week.${booking.weekday}`)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {booking.startTime}–{endTime(booking.startTime, booking.durationMinutes)}
                  </td>
                  <td className="py-2 pr-4">{booking.groupName}</td>
                  <td className="py-2 text-foreground-muted">
                    {/*
                      The pool as well as the lanes: "Pista 1, Pista 2" means
                      nothing at a club with three tanks.
                    */}
                    {booking.laneNames.length === 0
                      ? '—'
                      : [booking.poolName, booking.laneNames.join(', ')]
                          .filter(Boolean)
                          .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
