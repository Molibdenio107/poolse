import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import {
  addPersonCategory,
  CategoryAlreadyHeldError,
  listExpiringCategories,
  listPersonCategories,
  NoSuchCategoryError,
  NoSuchPersonError,
  removePersonCategory,
  renewPersonCategory,
  type ExpiringCategory,
  type PersonCategory,
  type PersonCategoryInput,
  type PersonRef,
} from './person-categories.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A category on the person — POOLSE-202. Owner and admin read and write; there
 * is no reception role, and an instructor has no business with who is a
 * *Munícipe*. The family reads its own through `GET /app/categories`.
 *
 * Every refusal names a field and a translation key, so the screen says a
 * sentence in pt-PT and en rather than greying a button.
 */
@CoreRoute()
@Controller('person-categories')
export class PersonCategoriesController {
  @Get()
  async list(
    @Query('studentId') studentId?: string,
    @Query('membershipId') membershipId?: string,
  ): Promise<{ categories: PersonCategory[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    const found = await listPersonCategories(organizationId, person(studentId, membershipId));
    if (found === null) throw new NotFoundException('No such person');
    return { categories: found };
  }

  /** *Categorias a expirar*: valid for 30 days or fewer, soonest first. */
  @Get('expiring')
  async expiring(): Promise<{ expiring: ExpiringCategory[] }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();
    return { expiring: await listExpiringCategories(organizationId) };
  }

  @Post()
  async add(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    const who = person(text(body['studentId']), text(body['membershipId']));
    const categoryId = text(body['categoryId']);
    if (categoryId === undefined || !UUID.test(categoryId)) {
      throw new BadRequestException({
        message: 'Choose a category',
        fields: { categoryId: 'personCategories.errors.categoryRequired' },
      });
    }
    const input: PersonCategoryInput = { categoryId, ...dates(body) };
    try {
      return { id: await addPersonCategory(organizationId, who, membershipId, input) };
    } catch (error) {
      if (error instanceof NoSuchPersonError) throw new NotFoundException('No such person');
      if (error instanceof NoSuchCategoryError) {
        throw new BadRequestException({
          message: 'No such category',
          fields: { categoryId: 'personCategories.errors.categoryRequired' },
        });
      }
      if (error instanceof CategoryAlreadyHeldError) {
        throw new ConflictException({
          code: 'person_category_held',
          message: 'This person already has that category',
          fields: { categoryId: 'personCategories.errors.alreadyHeld' },
        });
      }
      throw error;
    }
  }

  /** Renew: new proof, new dates. */
  @Patch(':id')
  async renew(@Param('id') id: string, @Body() body: Record<string, unknown>): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    if (!UUID.test(id)) throw new NotFoundException('No such category');
    const { organizationId, membershipId } = currentTenant();
    if (!(await renewPersonCategory(organizationId, id, membershipId, dates(body)))) {
      throw new NotFoundException('No such category');
    }
    return { updated: true };
  }

  @Post(':id/archive')
  async remove(@Param('id') id: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    if (!UUID.test(id)) throw new NotFoundException('No such category');
    const { organizationId } = currentTenant();
    if (!(await removePersonCategory(organizationId, id))) {
      throw new NotFoundException('No such category');
    }
    return { archived: true };
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Exactly one of the two, and a uuid; anything else is a person this club does not have. */
function person(studentId: string | undefined, membershipId: string | undefined): PersonRef {
  if (studentId !== undefined && membershipId === undefined && UUID.test(studentId)) return { studentId };
  if (membershipId !== undefined && studentId === undefined && UUID.test(membershipId)) return { membershipId };
  throw new NotFoundException('No such person');
}

function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const at = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/**
 * Proof date (required), valid-until (optional, not before the proof) and notes
 * (200 characters, never a document number). The database refuses the same
 * things; these say which field, in words.
 */
function dates(body: Record<string, unknown>): Omit<PersonCategoryInput, 'categoryId'> {
  const proofSeenOn = text(body['proofSeenOn']);
  if (proofSeenOn === undefined || !isDay(proofSeenOn)) {
    throw new BadRequestException({
      message: 'Say when the proof was seen',
      fields: { proofSeenOn: 'personCategories.errors.proofSeenOn' },
    });
  }
  const validUntil = text(body['validUntil']) ?? null;
  if (validUntil !== null && !isDay(validUntil)) {
    throw new BadRequestException({
      message: 'Valid until is not a date',
      fields: { validUntil: 'personCategories.errors.validUntil' },
    });
  }
  if (validUntil !== null && validUntil < proofSeenOn) {
    throw new BadRequestException({
      message: 'Valid until is before the proof was seen',
      fields: { validUntil: 'personCategories.errors.validBeforeProof' },
    });
  }
  const notes = text(body['notes']) ?? null;
  if (notes !== null && notes.length > 200) {
    throw new BadRequestException({
      message: 'Notes are 200 characters at most',
      fields: { notes: 'personCategories.errors.notesLong' },
    });
  }
  if (notes !== null && /[0-9]{6,}/.test(notes)) {
    throw new BadRequestException({
      message: 'Notes say what was seen, never its number',
      fields: { notes: 'personCategories.errors.notesNumber' },
    });
  }
  return { proofSeenOn, validUntil, notes };
}
