import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { isValidNif } from '@poolse/rules';
import { clientIpFrom } from '../organizations/signup-claim.js';
import { issueStamp, stampIsFresh } from './form-stamp.js';
import {
  readLeadForm,
  submitLead,
  type LeadSubmission,
  type PublicLeadForm,
} from './leads.repository.js';

/**
 * The version of the consent sentence the form shows — `leads.public.consent`
 * in the catalogue. Bump it, in the same change, whenever that sentence is
 * reworded: a lead records which words the family agreed to.
 */
export const LEAD_CONSENT_VERSION = '2026-10-13';

/** A parent's evening, not a script's: five sends a minute from one address. */
export const LEAD_ORIGIN_LIMIT = 5;
const ORIGIN_WINDOW_MS = 60_000;
const MAX_TRACKED_ORIGINS = 10_000;

/**
 * Per-origin counting that answers like a success.
 *
 * The global throttler answers 429, and a 429 is an answer — QA 3 wants a
 * flooding origin to read exactly what a parent reads. So this route keeps its
 * own small window and drops silently. In memory, per instance: a second Railway
 * instance doubles the allowance, which is still bounded by `submit_lead`'s
 * per-club ceiling in the database. The browser posts here directly, so
 * `request.ip` (with `trust proxy`) is the visitor, not the Next server.
 */
const recent = new Map<string, number[]>();

export function originAllows(origin: string, now = Date.now()): boolean {
  const since = now - ORIGIN_WINDOW_MS;
  const hits = (recent.get(origin) ?? []).filter((t) => t > since);
  if (hits.length >= LEAD_ORIGIN_LIMIT) {
    recent.set(origin, hits);
    return false;
  }
  hits.push(now);
  recent.set(origin, hits);
  if (recent.size > MAX_TRACKED_ORIGINS) {
    for (const [key, times] of recent) {
      if (times.every((t) => t <= since)) recent.delete(key);
    }
  }
  return true;
}

/** For tests only. */
export function forgetOrigins(): void {
  recent.clear();
}

/** Under this, a swimmer needs a guardian on the form. The club's own age of
 * majority is applied again when staff convert the lead. */
const FORM_MAJORITY = 18;

/**
 * The public sign-up — POOLSE-69. No session, no tenant; `public/(.*)` is in
 * `PUBLIC_ROUTES`, so neither Clerk nor the tenant middleware runs.
 *
 * **The GET** answers an open club's form or a 404, and the 404 is the same for
 * an unknown slug and for a club that has not opened its form — so the only clubs
 * it reveals are the ones that publish the link themselves.
 *
 * **The POST** answers 202 to everything that is shaped like a sign-up: a
 * honeypot, a stale or missing stamp, a noisy origin, an unknown slug, a closed
 * club and a database failure all read "recebemos o seu pedido". A malformed
 * body is a 400 naming its fields, decided before the slug is looked at, so it
 * says nothing about any club.
 */
@Controller('public/clubs')
export class PublicLeadsController {
  private readonly log = new Logger(PublicLeadsController.name);

  @Get(':slug/registration')
  async form(
    @Param('slug') slug: string,
  ): Promise<{ form: PublicLeadForm; stamp: string; consentVersion: string }> {
    const form = await readLeadForm(slug);
    if (form === null) throw new NotFoundException();
    return { form, stamp: issueStamp(slug), consentVersion: LEAD_CONSENT_VERSION };
  }

  @Post(':slug/registration')
  @HttpCode(202)
  async submit(
    @Param('slug') slug: string,
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
  ): Promise<{ received: true }> {
    const lead = parseSubmission(body);

    const quiet =
      isFilled(body['website']) ||
      !stampIsFresh(slug, body['stamp']) ||
      !originAllows(clientIpFrom(request.headers['x-poolse-client-ip']) ?? request.ip ?? 'unknown');

    if (!quiet) {
      try {
        await submitLead(slug, lead);
      } catch (error) {
        this.log.warn(`A public sign-up was not recorded: ${String(error)}`);
      }
    }
    return { received: true };
  }
}

function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function text(
  body: Record<string, unknown>,
  key: string,
  max: number,
  fields: Record<string, string>,
  required = false,
): string | null {
  const raw = body[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') {
    if (required) fields[key] = 'leads.public.required';
    return null;
  }
  if (value.length > max) {
    fields[key] = 'leads.public.tooLong';
    return null;
  }
  return value;
}

function nif(body: Record<string, unknown>, key: string, fields: Record<string, string>): string | null {
  const value = text(body, key, 20, fields);
  if (value === null) return null;
  const digits = value.replace(/\s+/g, '');
  if (!isValidNif(digits)) {
    fields[key] = 'leads.public.invalidNif';
    return null;
  }
  return digits;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ageOn(birth: string, today: Date): number {
  const [y, m, d] = birth.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) {
    age -= 1;
  }
  return age;
}

/** The body as a submission, or a 400 naming the fields that are wrong. */
export function parseSubmission(
  body: Record<string, unknown>,
  today: Date = new Date(),
): LeadSubmission {
  const fields: Record<string, string> = {};

  const swimmerFirstName = text(body, 'swimmerFirstName', 100, fields, true);
  const swimmerLastName = text(body, 'swimmerLastName', 100, fields, true);

  const birth = text(body, 'swimmerBirthDate', 10, fields, true);
  let swimmerBirthDate: string | null = null;
  if (birth !== null) {
    const parsed = new Date(`${birth}T12:00:00Z`);
    if (!ISO_DAY.test(birth) || Number.isNaN(parsed.getTime()) || parsed > today
        || ageOn(birth, today) > 110) {
      fields['swimmerBirthDate'] = 'leads.public.invalidDate';
    } else {
      swimmerBirthDate = birth;
    }
  }

  const swimmerTaxNumber = nif(body, 'swimmerTaxNumber', fields);
  const guardianName = text(body, 'guardianName', 200, fields);
  const guardianRelationship = text(body, 'guardianRelationship', 80, fields);
  const guardianTaxNumber = nif(body, 'guardianTaxNumber', fields);

  const minor = swimmerBirthDate !== null && ageOn(swimmerBirthDate, today) < FORM_MAJORITY;
  if (minor) {
    if (guardianName === null) fields['guardianName'] = 'leads.public.guardianRequired';
    if (guardianRelationship === null) {
      fields['guardianRelationship'] = 'leads.public.guardianRequired';
    }
  }
  if (swimmerTaxNumber !== null && swimmerTaxNumber === guardianTaxNumber) {
    fields['guardianTaxNumber'] = 'leads.public.sameNif';
  }

  const email = text(body, 'email', 254, fields, true);
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fields['email'] = 'leads.public.invalidEmail';
  }
  const phone = text(body, 'phone', 40, fields);
  const note = text(body, 'note', 2000, fields);

  const facilityId = text(body, 'facilityId', 36, fields);
  const levelId = text(body, 'levelId', 36, fields);

  const rawDays = Array.isArray(body['preferredDays']) ? body['preferredDays'] : [];
  const preferredDays = [
    ...new Set(rawDays.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)),
  ].sort();

  if (body['consent'] !== true) fields['consent'] = 'leads.public.consentRequired';

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ code: 'invalid_registration', message: 'Check the form', fields });
  }

  return {
    swimmerFirstName: swimmerFirstName!,
    swimmerLastName: swimmerLastName!,
    swimmerBirthDate: swimmerBirthDate!,
    swimmerTaxNumber,
    guardianName: minor || guardianName !== null ? guardianName : null,
    guardianRelationship: guardianName !== null ? guardianRelationship : null,
    guardianTaxNumber: guardianName !== null ? guardianTaxNumber : null,
    email: email!,
    phone,
    note,
    facilityId: facilityId !== null && UUID.test(facilityId) ? facilityId : null,
    levelId: levelId !== null && UUID.test(levelId) ? levelId : null,
    preferredDays,
    locale: body['locale'] === 'en' ? 'en' : 'pt-PT',
    consentTextVersion: LEAD_CONSENT_VERSION,
  };
}
