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
  setGroupCategory,
  CategoryInUseError,
  DuplicateCategoryError,
  type FeeCategory,
} from './categories.repository.js';

const MAX_NAME = 60;

/**
 * The club's fee categories — POOLSE-23 AC4.
 *
 * **Reading is open to anyone who may see a turma**, because the category is
 * printed beside a turma's name and on an enrolment: it is a label, not an
 * amount, and nothing here says what anybody pays. Writing is owner and admin,
 * like every other list the club maintains.
 *
 * Organization-scoped rather than per facility: a concession is the club's
 * policy, and a "Sénior" that meant one thing at one pool and another at the
 * next is a category nobody could report on.
 */
@Controller('fee-categories')
export class FeeCategoriesController {
  @Get()
  async list(): Promise<{ categories: FeeCategory[]; canManage: boolean }> {
    requireRole('owner', 'admin', 'instructor');
    const { organizationId } = currentTenant();
    return {
      categories: await listCategories(organizationId),
      canManage: hasRole('owner', 'admin'),
    };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<{ id: string }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    try {
      return {
        id: await createCategory(organizationId, name(body['name']), order(body['sortOrder'])),
      };
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
      const renamed = await renameCategory(
        organizationId,
        id,
        name(body['name']),
        order(body['sortOrder']),
      );
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
 * Putting a turma or one person on a category.
 *
 * Two endpoints rather than one with a discriminator, because they are two
 * different decisions: a turma's category is a policy about a programme, and an
 * enrolment's is an exception made for a person. The precedence between them
 * lives in SQL, in `enrolment_fee_category`, so nothing here has to know it.
 */
@Controller('class-groups/:classGroupId')
export class GroupCategoryController {
  @Patch('fee-category')
  async set(
    @Param('classGroupId') classGroupId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    if (!(await setGroupCategory(organizationId, classGroupId, optionalId(body['categoryId'])))) {
      throw new BadRequestException('No such turma');
    }
    return { updated: true };
  }
}

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

function optionalId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
}
