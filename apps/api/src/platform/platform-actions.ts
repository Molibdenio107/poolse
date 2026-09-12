import { BadRequestException } from '@nestjs/common';
import type { SubscriptionStatus } from './platform.repository.js';

/**
 * What an operator may send, checked before it reaches a column — slice 3.
 *
 * Its own file rather than decorators on a DTO, matching the rest of this API:
 * there is no `class-validator` in the dependency list and adding one for four
 * fields would be a framework for a morning's work.
 *
 * **Every refusal names its field**, because `describeFailure` on the web side
 * puts a `fields` entry beside the box that caused it and falls back to a
 * top-of-form sentence otherwise. A 400 with prose and no field name is the
 * failure that ticket was written to remove.
 */

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'comped',
];

/**
 * How far ahead a trial may be set.
 *
 * Not a rule about trials — a rule about typing. `2027` for `2026` is one
 * keystroke and silently gives somebody two years free; every legitimate
 * extension is weeks. The past is deliberately allowed: ending a trial today is
 * a thing an operator means to do, and making them find another screen for it
 * would be the sort of gap somebody works around with a database client.
 */
const MAX_TRIAL_YEARS = 2;

/** A ceiling on a sentence shown verbatim to a club. The column agrees. */
const MAX_REASON_LENGTH = 500;

function refuse(field: string, key: string): never {
  throw new BadRequestException({ fields: { [field]: key } });
}

/** An ISO instant or date, within the typo guard. */
export function readTrialEndsAt(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') refuse('endsAt', 'admin.error.dateRequired');

  const at = new Date(raw as string);
  if (Number.isNaN(at.getTime())) refuse('endsAt', 'admin.error.dateInvalid');

  const ceiling = new Date();
  ceiling.setFullYear(ceiling.getFullYear() + MAX_TRIAL_YEARS);
  if (at > ceiling) refuse('endsAt', 'admin.error.dateTooFar');

  return at.toISOString();
}

export function readSubscriptionStatus(raw: unknown): SubscriptionStatus {
  if (typeof raw !== 'string' || !SUBSCRIPTION_STATUSES.includes(raw as SubscriptionStatus)) {
    refuse('status', 'admin.error.statusInvalid');
  }
  return raw as SubscriptionStatus;
}

/**
 * At least one site. The CHECK on the column says the same thing, and this says
 * it in a sentence beside the field rather than as a constraint name in a 500.
 */
export function readMaxFacilities(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value) || value < 1) refuse('maxFacilities', 'admin.error.atLeastOne');
  return value;
}

/**
 * Null is unlimited, never zero — the reading every ceiling in this schema has.
 *
 * An empty string means "clear it", which is what an operator emptying the box
 * means. A literal `0` is refused rather than silently treated as unlimited: a
 * quota of nought is a tenant nobody can log into, and it is not a state
 * anybody means to create.
 */
export function readMaxManagementUsers(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;

  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < 1) {
    refuse('maxManagementUsers', 'admin.error.atLeastOneOrEmpty');
  }
  return value;
}

/** A sentence the suspended club will read. Required, trimmed, bounded. */
export function readSuspensionReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason === '') refuse('reason', 'admin.error.reasonRequired');
  if (reason.length > MAX_REASON_LENGTH) refuse('reason', 'admin.error.reasonTooLong');
  return reason;
}
