import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireRole } from '../tenant/roles.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  renameCategory,
  setEnrollmentCategory,
  CategoryInUseError,
  DuplicateCategoryError,
  type FeeCategory,
  type FeeCategoryInput,
} from './categories.repository.js';

const MAX_NAME = 60;

/**
 * The club's fee categories — POOLSE-23 AC4.
 *
 * **Reading a category's name is open to anyone who may see a turma** — it is
 * printed beside a turma's name and on an enrolment. **Reading what it is worth
 * is not.** Since round 19 a category carries a discount, and the price list
 * refuses an instructor outright (POOLSE-42 AC10, "no amounts at all"); the same
 * answer has to hold here or a concession becomes the way round it.
 *
 * So the values come back null for an instructor, with `canSeeValues` beside
 * them saying why. Null on its own would read as "no discount", which is a
 * different fact and the one nobody should infer from a blank.
 *
 * Organization-scoped rather than per facility: a concession is the club's
 * policy, and a "Sénior" that meant one thing at one pool and another at the
 * next is a category nobody could report on. It is *shown* on each site's page,
 * beside the price list it modifies, which is where an operator is standing when
 * they think about it — the panel says it is the club's own list.
 */
@Controller('fee-categories')
export class FeeCategoriesController {
  @Get()
  async list(): Promise<{
    categories: FeeCategory[];
    canManage: boolean;
    canSeeValues: boolean;
  }> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();

    const canSeeValues = hasRole('owner', 'admin');
    const categories = await listCategories(organizationId);

    return {
      // Blanked here rather than left out of the query, so there is one shape of
      // row and one place that decides who sees the figure.
      categories: canSeeValues
        ? categories
        : categories.map((category) => ({
            ...category,
            discountPercent: null,
            discountCents: null,
          })),
      canManage: hasRole('owner', 'admin'),
      canSeeValues,
    };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      return { id: await createCategory(organizationId, input(body)) };
    } catch (error) {
      refuseDuplicate(error);
    }
  }

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      const renamed = await renameCategory(organizationId, id, input(body));
      if (!renamed) throw new BadRequestException('No such category');
    } catch (error) {
      refuseDuplicate(error);
    }
    return { updated: true };
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<{ archived: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      if (!(await archiveCategory(organizationId, id))) {
        throw new BadRequestException('No such category');
      }
    } catch (error) {
      /*
       * The figures travel as fields, not inside a sentence — the same contract
       * every refusal that needs numbers uses here. "2 turmas e 5 inscrições"
       * is one translation entry per language rather than a string built in
       * TypeScript and translated by nobody.
       */
      if (error instanceof CategoryInUseError) {
        throw new ConflictException({
          code: 'fee_category_in_use',
          message: 'Turmas or enrolments still use this category',
          values: { groups: error.groups, enrollments: error.enrollments },
        });
      }
      throw error;
    }
    return { archived: true };
  }
}

/**
 * Putting **one person** on a category, against their turma's.
 *
 * There is deliberately no endpoint for the turma's own: that is part of the
 * turma's input, saved by the form that owns every other fact about it. A second
 * write path for one field is how two screens end up disagreeing about what was
 * saved.
 *
 * This one has no such home — an enrolment has no form of its own, and "this
 * person, not their turma" is a decision taken from the student's record. The
 * precedence between the two lives in SQL, in `enrolment_fee_category`, so
 * nothing here has to know it.
 */
@Controller('enrollments/:enrollmentId')
export class EnrollmentCategoryController {
  @Patch('fee-category')
  async set(
    @Param('enrollmentId') enrollmentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const updated = await setEnrollmentCategory(
      organizationId,
      enrollmentId,
      optionalId(body['categoryId']),
    );
    if (!updated) throw new BadRequestException('No such enrolment');
    return { updated: true };
  }

  /**
   * Clearing a person's own category means "back to whatever the turma says",
   * not "no category". A DELETE says that better than a PATCH with a null in it.
   */
  @Delete('fee-category')
  async clear(@Param('enrollmentId') enrollmentId: string): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await setEnrollmentCategory(organizationId, enrollmentId, null))) {
      throw new BadRequestException('No such enrolment');
    }
    return { updated: true };
  }
}

function refuseDuplicate(error: unknown): never {
  if (error instanceof DuplicateCategoryError) {
    throw new ConflictException({
      code: 'fee_category_exists',
      message: 'A category with that name already exists',
      fields: { name: 'categories.nameTaken' },
    });
  }
  throw error;
}

function name(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') {
    throw new BadRequestException({
      code: 'name_required',
      message: 'A category needs a name',
      fields: { name: 'categories.nameRequired' },
    });
  }
  if (trimmed.length > MAX_NAME) {
    throw new BadRequestException(`name may be at most ${MAX_NAME} characters`);
  }
  return trimmed;
}

function order(value: unknown): number {
  return Number.isInteger(value) ? (value as number) : 0;
}

/**
 * The whole writable category, refused as a whole.
 *
 * **One kind of discount or the other, never both**, which the CHECK says too —
 * said here as well so the refusal names the box rather than arriving as a 500
 * quoting a constraint. Absent means the category carries no value, which is a
 * label and stays a legitimate thing to want; it is not zero, and a client that
 * sends 0 is taken at its word.
 *
 * The amount is `parseCents`'s job everywhere else in this codebase and it is
 * the client that calls it — what arrives here is already integer cents, and
 * anything else is refused rather than rounded into something plausible.
 */
function input(body: Record<string, unknown>): FeeCategoryInput {
  const percent = body['discountPercent'];
  const cents = body['discountCents'];

  if (percent !== null && percent !== undefined && cents !== null && cents !== undefined) {
    throw new BadRequestException({
      code: 'one_discount',
      message: 'A category takes a percentage or an amount, not both',
      fields: { discountValue: 'categories.oneDiscount' },
    });
  }

  return {
    name: name(body['name']),
    sortOrder: order(body['sortOrder']),
    discountPercent: percentage(percent),
    discountCents: amount(cents),
  };
}

function percentage(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new BadRequestException({
      code: 'discount_out_of_range',
      message: 'A percentage discount is between 0 and 100',
      fields: { discountValue: 'categories.percentRange' },
    });
  }
  return value;
}

function amount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new BadRequestException({
      code: 'discount_not_an_amount',
      message: 'A fixed discount is a whole number of cents, zero or more',
      fields: { discountValue: 'categories.amountInvalid' },
    });
  }
  return value as number;
}

function optionalId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
}
