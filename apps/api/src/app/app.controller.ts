import { familyFees, type FamilyChildFees } from '../billing/family-fees.repository.js';
import { familyDocuments, familyFpnReview, type FamilyDocumentRow, type FpnReview } from '../students/family-documents.repository.js';
import { payToFor, type PayTo } from '../billing/payment-destinations.js';
import {
  listPayerInvoices,
  readPayerInvoice,
  type PayerInvoice,
  type PayerInvoiceItem,
} from '../billing/payer-invoices.repository.js';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute, moduleIsOn } from '../tenant/modules.js';
import { familyStudents } from '../students/students.repository.js';
import { studentFees } from '../billing/fees.repository.js';
import type { FeeBalance } from '../billing/fee-balance.js';
import {
  type LessonCount,
  readAgenda,
  readClassmates,
  type Classmates,
  readCalendar,
  readCalendarClosures,
  type CalendarClosure,
  type CalendarEntry,
  readLessonCount,
  readRecent,
  readWater,
  type AgendaEntry,
  type RecentLesson,
  type WaterReading,
} from './agenda.repository.js';
import {
  familyFeedback,
  FeedbackRefusedError,
  recentTaughtFeedback,
  saveFeedback,
  type FamilyFeedback,
  type LessonFeedback,
  type TaughtLessonFeedback,
} from '../feedback/feedback.repository.js';
import { listMedicalLeave, type CertificateFile } from '../students/medical-leave.repository.js';
import { agendaWindowAllowed } from '@poolse/rules';
import { clubToday } from '../common/club-day.js';
import { readMyWeek, type WeekClass } from '../dashboard/instructor.repository.js';
import { readMaintenanceHome, type MaintenanceHome } from './maintenance-home.repository.js';
import {
  teachingStudentCard,
  teachingStudents,
  type TeachingStudent,
  type TeachingStudentCard,
} from './teaching-students.repository.js';
import { readRegistrationSettings } from '../leads/leads.repository.js';
import {
  appRequestOptions,
  AppRequestRefused,
  submitAppRequest,
  type AppRequestInput,
  type AppRequestOptions,
} from '../leads/app-requests.repository.js';
import { LEAD_CONSENT_VERSION } from '../leads/public-leads.controller.js';
import { Throttle } from '@nestjs/throttler';
import { FAMILY_UPLOAD } from '../common/throttle.js';
import { judgeUpload } from '../files/upload-check.js';
import { heicToJpeg, looksLikeHeic } from '../files/heic.js';
import { readDocumentEdit, saveEdit } from '../students/documents.controller.js';
import { parseIdentity } from '../students/identity.js';
import { mayTakeFpnFor, SENDABLE, sendDocument, type SendableKind } from '../students/family-submissions.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Child {
  id: string;
  name: string;
  relationship: string | null;
  /** The reader is this student — the adult path, or a student's own login. */
  self: boolean;
  /** What is owed, from the fee read's `balance`; null when nothing is agreed. */
  fees: (FeeBalance & { lines: number }) | null;
  /** Where to pay, when something is owed and the club says where — POOLSE-94. */
  payTo: PayTo | null;
}

interface AgendaResponse {
  children: Child[];
  entries: AgendaEntry[];
  /** Latest temperature per tank in the entries; empty with water quality off. */
  water: WaterReading[];
  /** *Últimas aulas* — attended lessons inside the feedback window (POOLSE-116). */
  recent: RecentLesson[];
}

/** The agenda over a window, for *Aulas* — POOLSE-175. */
interface CalendarResponse extends Omit<AgendaResponse, 'entries'> {
  entries: CalendarEntry[];
  closures: CalendarClosure[];
}

/** A comment's ceiling — the table's CHECK says the same. */
const MAX_COMMENT = 500;

/** A leave as a family reads it: the dates and the atestado, never the club's reason or reference. */
interface FamilyLeave {
  id: string;
  studentId: string;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  certificate: CertificateFile | null;
}

/** How long after it ends a leave still shows, so a late atestado can be sent. */
const LEAVE_SHOWN_DAYS = 90;

/**
 * App mode's family reads — POOLSE-90 slice 1.
 *
 * Guardians and students only, and only ever about the reader's own records:
 * the children come from `familyStudents`, and a `child` that is not one of
 * them is a 404, the answer `requireActsForStudent` gives a stranger. Staff who
 * are also parents reach this through their guardian role like anybody else.
 */
@CoreRoute()
@Controller('app')
export class AppController {
  @Get('agenda')
  async agenda(
    @Query('child') child?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AgendaResponse | CalendarResponse> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();

    const mine = await familyStudents(organizationId, membershipId);
    if (child !== undefined && !mine.some((one) => one.id === child)) {
      throw new NotFoundException('No such student');
    }
    const chosen = child === undefined ? mine : mine.filter((one) => one.id === child);

    // POOLSE-175: a window is both ends, inside the calendar's reach. Neither is
    // the two weeks *Início* and every older caller read, unchanged.
    if (from !== undefined || to !== undefined) {
      if (from === undefined || to === undefined || !agendaWindowAllowed(clubToday(), from, to)) {
        throw new BadRequestException('No such window');
      }
      const ids = chosen.map((one) => one.id);
      const entries = await readCalendar(organizationId, membershipId, ids, { from, to });
      return {
        children: await withFees(organizationId, mine),
        entries,
        closures: await readCalendarClosures(organizationId, ids, { from, to }),
        water: await waterFor(organizationId, entries),
        recent: await readRecent(organizationId, membershipId, ids),
      };
    }

    const entries = await readAgenda(
      organizationId,
      membershipId,
      chosen.map((one) => one.id),
    );
    return {
      children: await withFees(organizationId, mine),
      entries,
      water: await waterFor(organizationId, entries),
      recent: await readRecent(
        organizationId,
        membershipId,
        chosen.map((one) => one.id),
      ),
    };
  }

  /**
   * *Pagamentos* — POOLSE-178: each child's overdue, coming and settled fees,
   * and where to pay. `family` is every child, for the chips; `children` is the
   * one asked for, or all of them. Another family's child is a 404.
   */
  @Get('fees')
  async fees(
    @Query('child') child?: string,
  ): Promise<{ children: FamilyChildFees[]; family: { id: string; name: string }[] }> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();
    const mine = await familyStudents(organizationId, membershipId);
    if (child !== undefined && !mine.some((one) => one.id === child)) {
      throw new NotFoundException('No such student');
    }
    const chosen = child === undefined ? mine : mine.filter((one) => one.id === child);
    return {
      children: await Promise.all(chosen.map((one) => familyFees(organizationId, one, mine))),
      family: mine.map((one) => ({ id: one.id, name: one.name })),
    };
  }

  /**
   * *Extratos* — POOLSE-201: the documents the reader pays, newest first, 20 at
   * a time. `payer: false` says to hide the row on *Perfil*. The list carries
   * no NIF or address; only the document read does, and only to its payer.
   */
  @Get('invoices')
  @Header('Cache-Control', 'private, no-store')
  async invoices(
    @Query('offset') offset?: string,
  ): Promise<{ payer: boolean; documents: PayerInvoiceItem[]; next: number | null }> {
    requireRole('guardian', 'student');
    // Invoicing switched off for the club: no documents, and no row on *Perfil*.
    if (!moduleIsOn('invoicing')) return { payer: false, documents: [], next: null };
    const { organizationId, membershipId } = currentTenant();
    const from = offset === undefined ? 0 : Number(offset);
    if (!Number.isInteger(from) || from < 0 || from > 100_000) {
      throw new BadRequestException('offset must be a whole number');
    }
    return listPayerInvoices(organizationId, membershipId, from);
  }

  /**
   * One document, for its payer — POOLSE-201. Anybody else's, another tenant's
   * or a number that does not exist is the same 404. Audited.
   */
  @Get('invoices/:id')
  @Header('Cache-Control', 'private, no-store')
  async invoice(@Param('id') id: string): Promise<PayerInvoice> {
    requireRole('guardian', 'student');
    if (!UUID.test(id) || !moduleIsOn('invoicing')) throw new NotFoundException('No such document');
    const { organizationId, membershipId } = currentTenant();
    const found = await readPayerInvoice(organizationId, membershipId, id);
    if (found === null) throw new NotFoundException('No such document');
    return found;
  }

  /**
   * The FPN form's values, for the person who will sign it — POOLSE-193. Its own
   * route, because `/app/documents` carries no number and this one reads it, audited.
   * A minor's own login does not take the form, so it does not read this.
   */
  @Get('documents/fpn')
  async fpnReview(@Query('child') child?: string): Promise<FpnReview> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();
    const mine = await familyStudents(organizationId, membershipId);
    if (child === undefined || !mine.some((one) => one.id === child)) {
      throw new NotFoundException('No such student');
    }
    if (!membershipId || !(await mayTakeFpnFor(organizationId, membershipId, child))) {
      throw new ForbiddenException({ code: 'minor_reads_only', message: 'A guardian takes this form' });
    }
    const review = await familyFpnReview(organizationId, child, membershipId);
    if (review === null) throw new NotFoundException('No such document');
    return review;
  }

  /**
   * The person corrects what the FPN form prints — POOLSE-193 (Rui, 06-11-2026):
   * straight onto the record, through the office's own reading and save, because the
   * signed form is what the office reviews. Named in the log, never valued. Locked
   * while a signed copy waits, so the form on the office's desk matches the record.
   */
  @Patch('documents/fpn')
  async saveFpnDetails(
    @Query('child') child: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ saved: true }> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();
    const mine = await familyStudents(organizationId, membershipId);
    if (child === undefined || !mine.some((one) => one.id === child)) {
      throw new NotFoundException('No such student');
    }
    if (!membershipId || !(await mayTakeFpnFor(organizationId, membershipId, child))) {
      throw new ForbiddenException({ code: 'minor_reads_only', message: 'A guardian takes this form' });
    }
    const rows = await familyDocuments(organizationId, child, membershipId);
    const row = rows?.find((one) => one.kind === 'fpn_declaration');
    // A child no form is asked of has nothing to correct: the same answer as the read.
    if (row === undefined) throw new NotFoundException('No such document');
    if (row.status === 'sent') {
      throw new ConflictException({ code: 'already_sent', message: 'A signed copy is waiting for the office' });
    }
    // Named keys only, and only those sent: a body cannot reach `idDocumentClear`,
    // and a key it left out never reads as a blank that wipes what is on file.
    const sent = (keys: readonly string[]): Record<string, unknown> =>
      Object.fromEntries(keys.filter((key) => key in body).map((key) => [key, body[key]]));
    const address = sent(['addressLine', 'locality', 'postalCode']);
    const identity = parseIdentity(address);
    if (identity !== undefined && Object.keys(address).length < 3) {
      throw new BadRequestException({ code: 'partial_address', message: 'The address is saved as one group' });
    }
    // The ID document is one group too: its save writes both dates, so a body that
    // left one out would blank it.
    const document = sent(['idDocumentType', 'idDocumentNumber', 'idDocumentIssuedOn', 'idDocumentValidUntil']);
    if (Object.keys(document).length > 0 && Object.keys(document).length < 4) {
      throw new BadRequestException({ code: 'partial_id_document', message: 'The ID document is saved as one group' });
    }
    const edit = readDocumentEdit({ ...document, ...sent(['disciplines']) });
    await saveEdit(organizationId, child, {
      ...edit,
      ...(identity === undefined
        ? {}
        : {
            address: {
              addressLine: identity.addressLine,
              locality: identity.locality,
              postalCode: identity.postalCode,
            },
          }),
    });
    return { saved: true };
  }

  /**
   * *Documentos* — POOLSE-179: each child's papers as a status, by their sports.
   * Another family's child is a 404.
   */
  @Get('documents')
  async documents(@Query('child') child?: string): Promise<{
    children: { id: string; name: string; documents: FamilyDocumentRow[] }[];
    family: { id: string; name: string }[];
  }> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId, viewing } = currentTenant();
    const mine = await familyStudents(organizationId, membershipId);
    if (child !== undefined && !mine.some((one) => one.id === child)) {
      throw new NotFoundException('No such student');
    }
    const chosen = child === undefined ? mine : mine.filter((one) => one.id === child);
    return {
      children: await Promise.all(
        chosen.map(async (one) => ({
          id: one.id,
          name: one.name,
          // POOLSE-188: a view takes no form and sends no paper, so the list says so
          // and the screen draws neither, rather than offering what would be refused.
          // The exam goes altogether: `expired` is also how an unfit result reads, so
          // its state is health data (rule 8).
          documents: ((await familyDocuments(organizationId, one.id, membershipId)) ?? [])
            .filter((row) => viewing == null || row.kind !== 'medical_exam')
            .map((row) =>
              viewing == null ? row : { ...row, print: null, canSend: false, incomplete: false },
            ),
        })),
      ),
      family: mine.map((one) => ({ id: one.id, name: one.name })),
    };
  }

  /**
   * A family sends a document — POOLSE-179 slice 2. The raw file in the body,
   * as `POST /files` takes it; `kind` is one of `SENDABLE`, and an exam carries
   * the date read off it. A live encarregado, or the student from 18; anybody
   * else, and another family's child, is a 404. Nothing the office holds
   * changes until it accepts (`family_submission`).
   *
   * An iPhone's HEIC is turned into a JPEG first, then judged like any upload:
   * by its bytes, 10 MB at most. Ten sendings an hour per person.
   */
  @Throttle(FAMILY_UPLOAD)
  @Post('documents/:kind')
  async sendDocument(
    @Param('kind') kind: string,
    @Query('child') child: string | undefined,
    @Query('name') name: string | undefined,
    @Query('examinedOn') examinedOn: string | undefined,
    @Body() body: unknown,
  ): Promise<{ sent: true }> {
    requireRole('guardian', 'student');
    if (!(SENDABLE as readonly string[]).includes(kind)) throw new NotFoundException('No such document');
    if (child === undefined || !UUID.test(child)) throw new NotFoundException('No such student');
    let date: string | null = null;
    if (kind === 'medical_exam') {
      if (examinedOn === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(examinedOn) || examinedOn > clubToday()) {
        throw new BadRequestException({ code: 'exam_date', message: 'The exam date is needed, and not in the future' });
      }
      date = examinedOn;
    }
    const { organizationId, membershipId } = currentTenant();
    // Another family's child is a 404 before anything about it is read.
    const mine = await familyStudents(organizationId, membershipId);
    if (!mine.some((one) => one.id === child)) throw new NotFoundException('No such student');

    // The kind must be one this child's sports ask for (BA 2).
    const documents = await familyDocuments(organizationId, child, membershipId);
    const row = documents?.find((one) => one.kind === kind);
    if (row === undefined) throw new NotFoundException('No such document');
    if (!row.canSend) {
      if (row.status === 'sent') throw new ConflictException({ code: 'already_sent', message: 'One is already waiting for the office' });
      // POOLSE-193: hiding the button is not the control.
      if (row.incomplete) throw new ConflictException({ code: 'form_incomplete', message: 'Mandatory data is missing' });
      // A minor's own login reads its papers and never sends them (BA 1, QA 6).
      throw new ForbiddenException({ code: 'minor_reads_only', message: 'A guardian sends this' });
    }

    let raw = body;
    let fileName = name;
    if (Buffer.isBuffer(body) && looksLikeHeic(body)) {
      const jpeg = await heicToJpeg(body);
      if (jpeg === 'too_large') throw new BadRequestException({ code: 'file_too_large', message: 'This photo is too large' });
      if (jpeg === 'unreadable') throw new BadRequestException({ code: 'file_type', message: 'This photo could not be read' });
      raw = jpeg;
      fileName = (name ?? 'foto').replace(/\.(heic|heif)$/i, '') + '.jpg';
    }
    const { bytes, contentType, originalName } = judgeUpload(
      kind === 'id_document' ? 'student_id_document' : kind === 'medical_exam' ? 'medical_certificate' : 'student_document',
      raw,
      fileName,
    );

    const outcome = await sendDocument(organizationId, membershipId, child, kind as SendableKind, date, bytes, contentType, originalName);
    if (outcome === 'not_found') throw new NotFoundException('No such student');
    if (outcome === 'pending') throw new ConflictException({ code: 'already_sent', message: 'One is already waiting for the office' });
    if (outcome === 'no_season') throw new ConflictException({ code: 'no_season', message: 'The club has no published season' });
    return { sent: true };
  }

  /**
   * The children's medical leaves, for sending the atestado — POOLSE-109.
   * Leaves the club recorded, current or ended in the last 90 days; the family
   * sees the dates and its own atestado, never the reason the office typed.
   */
  @Get('medical-leave')
  async medicalLeave(): Promise<{ leaves: FamilyLeave[] }> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();
    const mine = await familyStudents(organizationId, membershipId);
    const since = shiftDays(clubToday(), -LEAVE_SHOWN_DAYS);
    const leaves: FamilyLeave[] = [];
    for (const child of mine) {
      for (const leave of await listMedicalLeave(organizationId, child.id, true)) {
        if (leave.endsOn !== null && leave.endsOn < since) continue;
        leaves.push({
          id: leave.id,
          studentId: child.id,
          startsOn: leave.startsOn,
          endsOn: leave.endsOn,
          active: leave.active,
          certificate: leave.certificate?.file ?? null,
        });
      }
    }
    return { leaves };
  }

  /**
   * One lesson, for the lesson's page: the entries for this session among the
   * reader's children. Not theirs, not coming, or not a turma lesson: 404.
   */
  @Get('lessons/:sessionId')
  async lesson(
    @Param('sessionId') sessionId: string,
  ): Promise<Omit<AgendaResponse, 'children' | 'recent'> & { feedback: FamilyFeedback[]; count: LessonCount }> {
    requireRole('guardian', 'student');
    if (!UUID.test(sessionId)) throw new NotFoundException('No such lesson');
    const { organizationId, membershipId } = currentTenant();

    const mine = await familyStudents(organizationId, membershipId);
    const entries = await readAgenda(
      organizationId,
      membershipId,
      mine.map((one) => one.id),
      sessionId,
    );
    if (entries.length === 0) throw new NotFoundException('No such lesson');
    return {
      entries,
      water: await waterFor(organizationId, entries),
      count: await readLessonCount(organizationId, sessionId),
      feedback: await familyFeedback(
        organizationId,
        membershipId,
        sessionId,
        [...new Set(entries.map((entry) => entry.studentId))],
      ),
    };
  }

  /**
   * Who teaches this lesson and who is in it — POOLSE-194. For a family with a
   * child in it, and a 404 for anybody else's lesson. A route of its own, because
   * `lessons/:sessionId` carries numbers only.
   */
  @Get('lessons/:sessionId/classmates')
  async classmates(@Param('sessionId') sessionId: string): Promise<Classmates> {
    requireRole('guardian', 'student');
    if (!UUID.test(sessionId)) throw new NotFoundException('No such lesson');
    const { organizationId, membershipId } = currentTenant();
    const mine = (await familyStudents(organizationId, membershipId)).map((one) => one.id);
    const entries = await readAgenda(organizationId, membershipId, mine, sessionId);
    if (entries.length === 0) throw new NotFoundException('No such lesson');
    return readClassmates(organizationId, sessionId, mine);
  }

  /**
   * The instructor's home — POOLSE-90 slice 2: this week's lessons where they
   * are `resolved_instructor_id`, so a stand-in sees the night they cover and the
   * regular instructor does not. The dashboard band's own query, one definition,
   * with the enrolled count and the *Não vou* count beside each.
   */
  @Get('teaching')
  async teaching(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ lessons: WeekClass[] }> {
    requireRole('instructor');
    const { organizationId, membershipId } = currentTenant();
    // POOLSE-197: a window is both ends, inside the calendar's reach, as for a family.
    if (from === undefined && to === undefined) {
      return { lessons: await readMyWeek(organizationId, membershipId) };
    }
    if (from === undefined || to === undefined || !agendaWindowAllowed(clubToday(), from, to)) {
      throw new BadRequestException('No such window');
    }
    return { lessons: await readMyWeek(organizationId, membershipId, { from, to }) };
  }

  /**
   * What families said about the reader's last seven lessons (Rui, 07-11-2026).
   * The lesson's teacher only, as on the lesson's own page; not on the view list,
   * so a view does not open it.
   */
  @Get('teaching/feedback')
  async teachingFeedback(): Promise<{ lessons: TaughtLessonFeedback[] }> {
    requireRole('instructor');
    const { organizationId, membershipId } = currentTenant();
    return { lessons: await recentTaughtFeedback(organizationId, membershipId) };
  }

  /**
   * The teacher's *Alunos* tab (Rui, 07-11-2026): the students of the turmas they
   * teach. Not on the view list: a view does not open a family's numbers.
   */
  @Get('teaching/students')
  async teachingStudentList(): Promise<{ students: TeachingStudent[] }> {
    requireRole('instructor');
    const { organizationId, membershipId } = currentTenant();
    return { students: await teachingStudents(organizationId, membershipId) };
  }

  /**
   * The club's pre-registration address, for a teacher at the pool or a family
   * inviting friends to show as a QR or send (Rui, 07-11-2026). Public already (it
   * is on the posters); null while the club has pre-registration closed, so
   * nothing is offered that would refuse.
   */
  @Get('join-link')
  async joinLink(): Promise<{ slug: string | null }> {
    requireRole('instructor', 'guardian', 'student');
    const settings = await readRegistrationSettings(currentTenant().organizationId);
    return { slug: settings.open ? settings.slug : null };
  }

  /** One student's card: level, turmas, bests, insurance and who to call. 404 outside their turmas. */
  @Get('teaching/students/:studentId')
  async teachingStudent(@Param('studentId') studentId: string): Promise<TeachingStudentCard> {
    requireRole('instructor');
    if (!UUID.test(studentId)) throw new NotFoundException('No such student');
    const { organizationId, membershipId } = currentTenant();
    const card = await teachingStudentCard(organizationId, membershipId, studentId);
    if (card === null) throw new NotFoundException('No such student');
    return card;
  }

  /**
   * The maintenance home — POOLSE-90 slice 3: due tasks (the reader's or
   * nobody's), overdue Espaços and open issues across every site, plus where an
   * issue can be reported and an analysis recorded. Maintenance only; an owner
   * who also fixes the showers has the backoffice for this.
   */
  @Get('maintenance')
  async maintenance(): Promise<MaintenanceHome> {
    requireRole('maintenance');
    const { organizationId, membershipId } = currentTenant();
    return readMaintenanceHome(organizationId, membershipId);
  }

  /**
   * How the lesson went — POOLSE-116. One child's mood and a few words, written
   * or rewritten inside the window. The child must be the reader's and in this
   * lesson (else 404, as a stranger's lesson is), the reader must be the one who
   * answers for them (else 403), and the database decides whether the lesson
   * takes feedback at all (else 409 with its code).
   */
  @Put('lessons/:sessionId/feedback')
  async feedback(
    @Param('sessionId') sessionId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<LessonFeedback> {
    requireRole('guardian', 'student');
    if (!UUID.test(sessionId)) throw new NotFoundException('No such lesson');
    const { organizationId, membershipId } = currentTenant();
    const input = parseFeedback(body);

    const mine = await familyStudents(organizationId, membershipId);
    if (!mine.some((one) => one.id === input.studentId)) throw new NotFoundException('No such lesson');
    const [standing] = await familyFeedback(organizationId, membershipId, sessionId, [input.studentId]);
    if (standing === undefined) throw new NotFoundException('No such lesson');
    if (!standing.mayAnswer) {
      throw new ForbiddenException({ code: 'feedback_guardian_answers', message: 'app.feedback.guardianAnswers' });
    }

    try {
      return await saveFeedback(organizationId, membershipId, sessionId, input.studentId, {
        mood: input.mood,
        comment: input.comment,
        challengeDone: input.challengeDone,
      });
    } catch (error) {
      if (error instanceof FeedbackRefusedError) {
        throw new ConflictException({
          code: error.code,
          message: `app.feedback.refused.${error.code}`,
          ...(error.code === 'feedback_window_closed' ? { closesOn: error.value } : {}),
        });
      }
      throw error;
    }
  }

  /**
   * Asking to join a class — POOLSE-121 (Rui, 29-10-2026). The reader's own
   * people, every turma of the season with a free place, and the requests they
   * have sent. Nobody is enrolled: the request goes to Pedidos de inscrição.
   */
  @Get('enrolment-requests')
  async enrolmentOptions(): Promise<AppRequestOptions> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();
    return appRequestOptions(organizationId, membershipId);
  }

  @Post('enrolment-requests')
  async requestEnrolment(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('guardian', 'student');
    const { organizationId, membershipId } = currentTenant();
    const input = parseAppRequest(body);
    try {
      return { id: await submitAppRequest(organizationId, membershipId, input) };
    } catch (error) {
      if (error instanceof AppRequestRefused) {
        if (error.code === 'not_yours') throw new NotFoundException('No such student');
        throw new ConflictException({
          code: error.code,
          message: `app.join.refused.${error.code}`,
          // About the person, not the turma: said as a sentence, not beside the picker.
          fields:
            error.code === 'no_email' || error.code === 'too_many'
              ? {}
              : { classGroupId: `app.join.refused.${error.code}` },
        });
      }
      throw error;
    }
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The request as sent, or a 400 naming every field that is wrong. */
export function parseAppRequest(body: Record<string, unknown>, today: string = clubToday()): AppRequestInput {
  const fields: Record<string, string> = {};
  const text = (key: string, max: number, required: boolean): string | null => {
    const raw = body[key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value === '') {
      if (required) fields[key] = 'app.join.error.required';
      return null;
    }
    if (value.length > max) fields[key] = 'app.join.error.tooLong';
    return value;
  };

  const classGroupId = body['classGroupId'];
  if (typeof classGroupId !== 'string' || !UUID.test(classGroupId)) fields['classGroupId'] = 'app.join.error.class';

  const who = body['studentId'];
  let studentId: string | null = null;
  let newChild: AppRequestInput['newChild'] = null;
  if (who === 'new') {
    const firstName = text('firstName', 100, true);
    const lastName = text('lastName', 100, true);
    const relationship = text('relationship', 80, true);
    const birthDate = text('birthDate', 10, true);
    if (birthDate !== null) {
      const parsed = new Date(`${birthDate}T12:00:00Z`);
      if (!ISO_DAY.test(birthDate) || Number.isNaN(parsed.getTime())
          || parsed.toISOString().slice(0, 10) !== birthDate || birthDate > today) {
        fields['birthDate'] = 'app.join.error.birthDate';
      }
    }
    if (firstName && lastName && relationship && birthDate) {
      newChild = { firstName, lastName, birthDate, relationship };
    }
  } else if (typeof who === 'string' && UUID.test(who)) {
    studentId = who;
  } else {
    fields['studentId'] = 'app.join.error.person';
  }

  const note = text('note', 2000, false);
  if (body['consent'] !== true) fields['consent'] = 'app.join.error.consent';

  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({ code: 'invalid', message: 'Check the request', fields });
  }
  return {
    classGroupId: classGroupId as string,
    studentId,
    newChild,
    note,
    consentTextVersion: LEAD_CONSENT_VERSION,
    locale: body['locale'] === 'en' ? 'en' : 'pt-PT',
  };
}

function parseFeedback(body: Record<string, unknown>): {
  studentId: string;
  mood: number;
  comment: string | null;
  challengeDone: boolean | null;
} {
  const studentId = body['studentId'];
  if (typeof studentId !== 'string' || !UUID.test(studentId)) {
    throw new BadRequestException({ message: 'studentId is required', fields: { studentId: 'app.feedback.error.student' } });
  }
  const mood = body['mood'];
  if (typeof mood !== 'number' || !Number.isInteger(mood) || mood < 1 || mood > 5) {
    throw new BadRequestException({ message: 'mood is 1 to 5', fields: { mood: 'app.feedback.error.mood' } });
  }
  const raw = body['comment'];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw new BadRequestException({ message: 'comment is text', fields: { comment: 'app.feedback.error.comment' } });
  }
  const comment = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  if (comment !== null && [...comment].length > MAX_COMMENT) {
    throw new BadRequestException({
      message: `comment is at most ${MAX_COMMENT} characters`,
      fields: { comment: 'app.feedback.error.tooLong' },
    });
  }
  const done = body['challengeDone'];
  if (done !== undefined && done !== null && typeof done !== 'boolean') {
    throw new BadRequestException({ message: 'challengeDone is yes or no' });
  }
  return { studentId, mood, comment, challengeDone: done ?? null };
}

/** The water at the tanks these lessons are in — never when the module is off. */
async function waterFor(organizationId: string, entries: Pick<AgendaEntry, 'poolId'>[]): Promise<WaterReading[]> {
  if (!moduleIsOn('water_quality')) return [];
  const pools = [...new Set(entries.map((entry) => entry.poolId).filter((id): id is string => id !== null))];
  return readWater(organizationId, pools);
}

/** Each child's fee status — `balance`, the one definition, never re-added here. */
async function withFees(
  organizationId: string,
  children: { id: string; name: string; relationship: string | null; self: boolean }[],
): Promise<Child[]> {
  return Promise.all(
    children.map(async (child) => {
      const fees = await studentFees(organizationId, child.id);
      const lines = fees.lines.filter((line) => line.endsOn === null).length;
      const owing = fees.balance.outstandingCents > 0;
      return {
        ...child,
        fees: lines === 0 ? null : { ...fees.balance, lines },
        payTo: owing ? await payToFor(organizationId, child.id) : null,
      };
    }),
  );
}

/** A calendar day moved by whole days, as text — never through a timezone. */
function shiftDays(day: string, days: number): string {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
