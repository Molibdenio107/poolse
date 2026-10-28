import type { PartnerDayClash } from '@/app/(app)/dashboard/classes/classes.actions';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * One refused day, as a sentence — POOLSE-117. *Quarta 10:00 · Pista 2 já tem
 * 6A*. The API sends the facts; this composes the words, once, for the
 * calendar's *Colocar aqui* and the Turmas card's *Adicionar dia*.
 */
export function partnerClashSentence(t: Translate, clash: PartnerDayClash, startTime: string): string {
  const when = { day: t(`week.${clash.weekday}`), time: startTime };
  switch (clash.reason) {
    case 'lane_taken':
      return t('partnerDays.clash.laneTaken', { ...when, lane: clash.lane, holder: clash.holder });
    case 'already_booked':
      return t('partnerDays.clash.alreadyBooked', when);
    case 'closed':
      return t('partnerDays.clash.closed', when);
    case 'refused':
      return t('partnerDays.clash.refused', { ...when, code: clash.code });
  }
}
