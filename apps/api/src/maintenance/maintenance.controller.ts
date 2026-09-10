import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, requireCanArchive, requireRole } from '../tenant/roles.js';
import { readPageQuery, type Paginated } from '../common/pagination.js';
import {
  addTask,
  archiveCompletion,
  archiveTask,
  completeTask,
  getTask,
  listCompletions,
  listAssignees,
  listMyTasks,
  listTargets,
  listTasks,
  updateTask,
  UnknownTargetError,
  type MaintenanceTask,
  type Option,
  type TaskCompletion,
  type TaskInput,
  type TaskTarget,
} from './maintenance.repository.js';

/**
 * Planned maintenance — slice 4.3.
 *
 * **Three permission tiers, the same three espaços drew and for the same
 * reasons.** Reading is open to any member: knowing when the filter was last
 * backwashed is not privileged. *Recording that a job was done is open to every
 * management login*, including instructors — a feature that made the person who
 * did the work find an admin to say so would simply not be used, which is the
 * argument that settled logging a cleaning. **Defining the plan is owner and
 * admin**: what the club maintains, how often, and whose job it is, is a
 * decision about the club rather than about today.
 *
 * Its own controller and its own folder rather than more of `SpacesController`,
 * because a task is not about a space — it may name a tank, a piece of kit or
 * the site itself — and module 2 has more to come.
 */

/** Every management login. Not students, not guardians. */
const MANAGEMENT = ['owner', 'admin', 'instructor', 'maintenance'] as const;

/** Who decides what the club maintains and how often. */
const CAN_PLAN = ['owner', 'admin'] as const;

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const MAX_NOTE = 500;

/** A year and a day. Longer than any real cadence, short enough to catch a typo. */
const MAX_INTERVAL_DAYS = 366;

interface TaskListResponse {
  tasks: MaintenanceTask[];
  /** So the screen hides forms the API would refuse — never the control itself. */
  canPlan: boolean;
  canComplete: boolean;
}

interface FacilityTaskResponse extends TaskListResponse {
  /**
   * The pickers, whole.
   *
   * Shipped with the list rather than fetched by the form, because a picker
   * built from a paginated endpoint offers only page 1 — the trap POOLSE-29
   * names — and because a form that had to fetch three lists on open is three
   * spinners on a dialog.
   *
   * Only for somebody who may plan: a reader has no form to fill in, and the
   * staff list is not part of what a task list is for.
   */
  assignees: Option[];
  targets: TaskTarget[];
}

@Controller('maintenance')
export class MaintenanceController {
  /**
   * What is mine — the roadmap's "a task appears for the right person".
   *
   * Unassigned tasks come too, because a job nobody has been given still has to
   * be visible to somebody; a club that assigns nothing would otherwise see an
   * empty list and conclude the feature does not work. Paused tasks do not: this
   * is a list of things to do.
   *
   * Every management login, and it answers for *them* — there is no membership
   * parameter, so this endpoint cannot be asked about somebody else.
   */
  @Get('tasks/mine')
  async mine(): Promise<TaskListResponse> {
    requireRole(...MANAGEMENT);
    const { organizationId, membershipId } = currentTenant();

    return {
      tasks:
        membershipId === null
          ? []
          : await listMyTasks(organizationId, membershipId, true),
      canPlan: hasRole(...CAN_PLAN),
      canComplete: hasRole(...MANAGEMENT),
    };
  }

  /** Every task at one site, worst first. */
  @Get('facilities/:facilityId/tasks')
  async list(@Param('facilityId') facilityId: string): Promise<FacilityTaskResponse> {
    const { organizationId } = currentTenant();
    const canPlan = hasRole(...CAN_PLAN);

    return {
      tasks: await listTasks(organizationId, facilityId),
      canPlan,
      canComplete: hasRole(...MANAGEMENT),
      assignees: canPlan ? await listAssignees(organizationId) : [],
      targets: canPlan ? await listTargets(organizationId, facilityId) : [],
    };
  }

  @Post('facilities/:facilityId/tasks')
  async create(
    @Param('facilityId') facilityId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole(...CAN_PLAN);
    const { organizationId } = currentTenant();

    try {
      return { id: await addTask(organizationId, readTask(body, facilityId)) };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Patch('tasks/:taskId')
  async update(
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ updated: true }> {
    requireRole(...CAN_PLAN);
    const { organizationId } = currentTenant();

    // The facility never moves: a task belongs to the site it names, and letting
    // it move would let a target from one site follow it to another.
    const { facilityId: _ignored, ...input } = readTask(body, '');

    try {
      if (!(await updateTask(organizationId, taskId, input))) {
        throw new NotFoundException('No such task');
      }
      return { updated: true };
    } catch (error) {
      throw asHttp(error);
    }
  }

  @Post('tasks/:taskId/archive')
  async remove(@Param('taskId') taskId: string): Promise<{ archived: true }> {
    requireCanArchive();
    const { organizationId } = currentTenant();

    if (!(await archiveTask(organizationId, taskId))) {
      throw new NotFoundException('No such task');
    }
    return { archived: true };
  }

  /**
   * "Feito" — one tap, and the server fills in who.
   *
   * `performedAt` may be supplied because a job done on Saturday and typed in on
   * Monday is the ordinary case, and the whole due calculation runs from when
   * the work happened. Who did it may not: a record of who did something that
   * the doer can address to somebody else is not a record.
   */
  @Post('tasks/:taskId/completions')
  async complete(
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    requireRole(...MANAGEMENT);
    const { organizationId, membershipId } = currentTenant();

    if (membershipId === null) {
      throw new BadRequestException('Only a member of this organization can record work');
    }

    const id = await completeTask(
      organizationId,
      taskId,
      membershipId,
      performedMoment(body['performedAt']),
      text(body['note'], MAX_NOTE),
    );

    if (id === null) throw new NotFoundException('No such task');
    return { id };
  }

  @Get('tasks/:taskId')
  async one(@Param('taskId') taskId: string): Promise<{
    task: MaintenanceTask;
    canPlan: boolean;
    canComplete: boolean;
    /** Whole, and only for somebody who may plan — as on the list. */
    assignees: Option[];
  }> {
    const { organizationId } = currentTenant();
    const canPlan = hasRole(...CAN_PLAN);

    const task = await getTask(organizationId, taskId);
    if (task === null) throw new NotFoundException('No such task');

    return {
      task,
      canPlan,
      canComplete: hasRole(...MANAGEMENT),
      // Reassigning is the reason this page can edit at all: somebody leaves and
      // their jobs have to go to a colleague. The target is deliberately not
      // editable here — moving a task between tanks is rare enough that
      // re-creating it is honest — but who it is for is not rare.
      assignees: canPlan ? await listAssignees(organizationId) : [],
    };
  }

  @Get('tasks/:taskId/completions')
  async history(
    @Param('taskId') taskId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<Paginated<TaskCompletion>> {
    const { organizationId } = currentTenant();
    return listCompletions(organizationId, taskId, readPageQuery(page, limit));
  }

  /** Deleting somebody's entry is owner/admin, as every deletion here is. */
  @Post('completions/:completionId/archive')
  async removeCompletion(
    @Param('completionId') completionId: string,
  ): Promise<{ archived: true }> {
    requireCanArchive();
    const { organizationId } = currentTenant();

    if (!(await archiveCompletion(organizationId, completionId))) {
      throw new NotFoundException('No such entry');
    }
    return { archived: true };
  }
}

/**
 * A task, in a shape the database will accept.
 *
 * Validated here rather than left to the CHECK constraints, for the reason every
 * other parser in this codebase gives: a constraint violation arrives as a 500
 * and a Postgres string, which is a message for whoever wrote the migration
 * rather than for somebody who typed a zero into "every N days".
 */
function readTask(body: Record<string, unknown>, facilityId: string): TaskInput {
  const title = text(body['title'], MAX_TITLE);
  if (title === null) {
    throw new BadRequestException({ message: 'A task needs a title', field: 'title' });
  }

  const interval = body['intervalDays'];
  const intervalDays = typeof interval === 'number' ? interval : Number(interval);
  if (
    !Number.isInteger(intervalDays) ||
    intervalDays < 1 ||
    intervalDays > MAX_INTERVAL_DAYS
  ) {
    throw new BadRequestException({
      message: `How often must be a whole number of days, 1 to ${MAX_INTERVAL_DAYS}`,
      field: 'intervalDays',
    });
  }

  /*
   * At most one target, checked here because the schema deliberately does not.
   *
   * The columns are independent so módulo 2 can grow into them, and a request
   * naming only a site is legitimate. But a task about *both* a tank and a room
   * is a task nobody could describe, and letting two through would make every
   * screen choose one arbitrarily.
   */
  const targets = ['spaceId', 'poolId', 'inventoryItemId'].filter(
    (key) => id(body[key]) !== null,
  );
  if (targets.length > 1) {
    throw new BadRequestException({
      message: 'A task is about one thing: a space, a pool, or an item',
      field: targets[1] as string,
    });
  }

  return {
    facilityId,
    title,
    description: text(body['description'], MAX_DESCRIPTION),
    intervalDays,
    assignedTo: id(body['assignedTo']),
    spaceId: id(body['spaceId']),
    poolId: id(body['poolId']),
    inventoryItemId: id(body['inventoryItemId']),
    // Absent means active: a task created from a form with no pause control is a
    // task somebody intends to happen.
    active: body['active'] === undefined ? true : body['active'] === true,
  };
}

/** Trimmed, capped, and empty becomes null rather than a blank string. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`That text is longer than ${max} characters`);
  }
  return trimmed;
}

/** An optional reference: a non-empty string, or null. */
function id(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * When the work happened.
 *
 * Absent means now, which is the one-tap case. Anything present has to parse, so
 * a client sending rubbish is told rather than silently having "now" recorded
 * against work done last week.
 */
function performedMoment(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException({ message: 'That is not a date', field: 'performedAt' });
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException({ message: 'That is not a date', field: 'performedAt' });
  }

  return parsed.toISOString();
}

function asHttp(error: unknown): unknown {
  if (error instanceof UnknownTargetError) {
    return new BadRequestException({
      message: 'That space, pool or item is not at this site',
      field: 'target',
    });
  }
  return error;
}
