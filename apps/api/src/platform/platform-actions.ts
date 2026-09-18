import { BadRequestException } from '@nestjs/common';
import type {
  BillingMode,
  PaymentMethod,
  SubscriptionStatus,
} from './platform.repository.js';

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

/**
 * What an operator may set a tenant's status to.
 *
 * **`comped` is not on it since POOLSE-63.** A free pilot carries the word on
 * its billing mode, with an ordinary `active` status — one home for one fact —
 * so it is refused here and offered on the billing-mode control instead. The
 * value stays in the database enum, because removing one is a rebuild and a
 * value nothing writes costs nothing.
 *
 * **`expired` is on it**, and it is the clock's own state. An operator does not
 * normally type it, but a state a machine can reach and a person cannot correct
 * is a state nobody can undo at four o'clock on a Friday.
 */
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
];

export const BILLING_MODES: readonly BillingMode[] = ['stripe', 'manual', 'comped'];

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'bank_transfer', 'other'];

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

// ---------------------------------------------------------------------------
// Paid outside Stripe — POOLSE-63
// ---------------------------------------------------------------------------

/** A ceiling on a note nobody but the operator reads. The column agrees. */
const MAX_NOTE_LENGTH = 500;

/**
 * How far out of today a payment may be dated.
 *
 * Both directions, and the past is the wide one: recording last quarter's cash
 * in arrears is ordinary, and a receipt dated next year is a typo. The same
 * reasoning as the trial's two-year ceiling — a rule about typing, not about
 * money.
 */
const MAX_PAYMENT_YEARS_BACK = 5;
const MAX_PAYMENT_YEARS_AHEAD = 1;

/** How far ahead a payment may say it covers. A decade is a slipped digit. */
const MAX_COVER_YEARS_AHEAD = 5;

export function readBillingMode(raw: unknown): BillingMode {
  if (typeof raw !== 'string' || !BILLING_MODES.includes(raw as BillingMode)) {
    refuse('billingMode', 'admin.error.billingModeInvalid');
  }
  return raw as BillingMode;
}

export function readPaymentMethod(raw: unknown): PaymentMethod {
  if (typeof raw !== 'string' || !PAYMENT_METHODS.includes(raw as PaymentMethod)) {
    refuse('method', 'admin.error.methodInvalid');
  }
  return raw as PaymentMethod;
}

/**
 * A whole number of cents, above zero.
 *
 * Integer minor units all the way in, like every amount in this product: the
 * decimal is parsed in the browser by `parseCents` and never re-parsed here, so
 * there is one definition of what "35,50" means rather than two that agree until
 * somebody types a thousands separator.
 *
 * Zero is refused as well as negative. A payment of nothing is not a payment,
 * and recording one would move `paid_through` on the strength of no money.
 */
export function readAmountCents(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value) || value <= 0) refuse('amountCents', 'admin.error.amountInvalid');
  return value;
}

/** A `YYYY-MM-DD` day, or a named refusal. Days are days — never instants. */
function readDay(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    refuse(field, 'admin.error.dateInvalid');
  }
  const day = (raw as string).trim();
  if (Number.isNaN(Date.parse(day))) refuse(field, 'admin.error.dateInvalid');
  return day;
}

/** The day the money arrived, within the typo guard in both directions. */
export function readReceivedOn(raw: unknown): string {
  const day = readDay(raw, 'receivedOn');

  const floor = new Date();
  floor.setFullYear(floor.getFullYear() - MAX_PAYMENT_YEARS_BACK);
  const ceiling = new Date();
  ceiling.setFullYear(ceiling.getFullYear() + MAX_PAYMENT_YEARS_AHEAD);

  const at = new Date(`${day}T12:00:00.000Z`);
  if (at < floor || at > ceiling) refuse('receivedOn', 'admin.error.dateTooFar');
  return day;
}

/**
 * The last day this payment pays for — required, and the only thing that moves
 * `paid_through`.
 */
export function readCoversTo(raw: unknown): string {
  const day = readDay(raw, 'coversTo');

  const ceiling = new Date();
  ceiling.setFullYear(ceiling.getFullYear() + MAX_COVER_YEARS_AHEAD);
  if (new Date(`${day}T12:00:00.000Z`) > ceiling) refuse('coversTo', 'admin.error.dateTooFar');
  return day;
}

/** Optional, and never after the day it covers to. The CHECK says so too. */
export function readCoversFrom(raw: unknown, coversTo: string): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;

  const day = readDay(raw, 'coversFrom');
  if (day > coversTo) refuse('coversFrom', 'admin.error.periodReversed');
  return day;
}

/** Whatever the operator wants to remember about it. Bounded, never required. */
export function readPaymentNote(raw: unknown): string | null {
  const note = typeof raw === 'string' ? raw.trim() : '';
  if (note === '') return null;
  if (note.length > MAX_NOTE_LENGTH) refuse('note', 'admin.error.noteTooLong');
  return note;
}
