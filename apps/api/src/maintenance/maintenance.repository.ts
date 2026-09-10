import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import {
  windowed,
  TOTAL_COUNT,
  type PageQuery,
  type Paginated,
} from '../common/pagination.js';

/**
 * Planned maintenance — slice 4.3.
 *
 * A recurring job that belongs to somebody: contralavagem every Monday, service
 * the dosing pump quarterly, test the emergency lighting monthly. The unplanned
 * half — "the shower is broken" — is `maintenance_request` in the espaços
 * module, and the boundary between them is `interval_days`: a job with no
 * cadence is a request.
 *
 * **Due-ness is computed here, in SQL, and once.** There is no `next_due_at`
 * column and nothing keeps one up to date — the same argument overdue cleaning
 * makes in `spaces.repository.ts`, plus one of its own: a completion backdated
 * to when the work actually happened has to move the next due date with it, and
 * a stored date would only move if somebody remembered to recompute it. The API
 * ships the answer and the interface renders it.
 */

/** The state a task is in, derived on every read. */
export type TaskState = 'paused' | 'due' | 'scheduled';

export interface MaintenanceTask {
  id: string;
  facilityId: string;
  facilityName: string;
  title: string;
  description: string | null;
  intervalDays: number;
  active: boolean;

  /** The membership responsible, or null for anybody at the site. */
  assignedTo: string | null;
  assignedToName: string | null;
  /**
   * Whether that person is still on the staff list.
   *
   * A task assigned to somebody who has left is not reassigned automatically —
   * that would be Poolse deciding who does the work — but the screen has to be
   * able to say so, or the job silently belongs to nobody.
   */
  assigneeArchived: boolean;

  /** What it is about: a room, a tank, a piece of kit, or the site itself. */
  spaceId: string | null;
  spaceName: string | null;
  poolId: string | null;
  poolName: string | null;
  inventoryItemId: string | null;
  inventoryItemName: string | null;

  lastDoneAt: string | null;
  lastDoneByName: string | null;
  /** Null when it has never been done, which is exactly when it is already due. */
  nextDueAt: string | null;
  state: TaskState;
  /** How many days late, for a list that sorts by how bad it is. Zero unless due. */
  daysOverdue: number;
}

/*
 * The due rule, in one place.
 *
 * Read the branches in order, because the order is the rule:
 *   - paused        → never due. A task suspended while a tank is drained is
 *     not a failure, and a warning about it is one an operator learns to ignore.
 *     `space.active` says the same thing about a room shut for works.
 *   - never done    → due. An absence of history is not evidence that the work
 *     happened; a task nobody has ever completed is the most due thing on the
 *     site, and treating it as fine would hide exactly what this exists to show.
 *   - otherwise     → time since the last completion against the interval.
 *
 * `archived_at IS NULL` on the completion is the rule and not an optimisation: a
 * deleted completion did not happen, so removing one logged against the wrong
 * task puts that task straight back to due.
 */
const STATE = `
  CASE
    WHEN NOT t.active THEN 'paused'
    WHEN c.last_done_at IS NULL THEN 'due'
    WHEN now() - c.last_done_at > make_interval(days => t.interval_days) THEN 'due'
    ELSE 'scheduled'
  END`;

/*
 * How late, in whole days, and never negative.
 *
 * Only meaningful for a due task, so everything else is zero rather than a
 * negative number somebody would have to know to ignore — the same reasoning
 * that floors an invoice's outstanding amount at zero.
 */
const DAYS_OVERDUE = `
  CASE
    WHEN NOT t.active THEN 0
    WHEN c.last_done_at IS NULL THEN 0
    ELSE greatest(
      0,
      floor(
        extract(epoch FROM now() - c.last_done_at) / 86400 - t.interval_days
      )::int
    )
  END`;

/**
 * The name of a person, from Clerk's cache where they have a login and from the
 * membership where they do not.
 *
 * Most people in a club have no account — POOLSE-17's whole point — and an inner
 * join to `app_user` would drop precisely the maintenance contact this feature
 * is for. The same lesson 4.2's alert recipients learned.
 */
const ACTOR_NAME = (alias: string, user: string) =>
  `nullif(btrim(concat_ws(' ',
     coalesce(${user}.cached_first_name, ${alias}.first_name),
     coalesce(${user}.cached_last_name,  ${alias}.last_name))), '')`;

const TASK_JOINS = `
  JOIN facility f ON f.id = t.facility_id AND f.organization_id = t.organization_id
  LEFT JOIN membership am ON am.id = t.assigned_to AND am.organization_id = t.organization_id
  LEFT JOIN app_user au   ON au.id = am.app_user_id
  LEFT JOIN space s       ON s.id = t.space_id AND s.organization_id = t.organization_id
  LEFT JOIN pool p        ON p.id = t.pool_id AND p.organization_id = t.organization_id
  LEFT JOIN inventory_item i
    ON i.id = t.inventory_item_id AND i.organization_id = t.organization_id
  LEFT JOIN LATERAL (
    SELECT tc.performed_at AS last_done_at, tc.performed_by AS last_done_by
      FROM maintenance_task_completion tc
     WHERE tc.task_id = t.id AND tc.archived_at IS NULL
     ORDER BY tc.performed_at DESC
     LIMIT 1
  ) c ON true
  LEFT JOIN membership dm ON dm.id = c.last_done_by AND dm.organization_id = t.organization_id
  LEFT JOIN app_user du   ON du.id = dm.app_user_id`;

const TASK_COLUMNS = `
  t.id, t.facility_id, f.name AS facility_name,
  t.title, t.description, t.interval_days, t.active,
  t.assigned_to,
  ${ACTOR_NAME('am', 'au')} AS assigned_to_name,
  (am.id IS NOT NULL AND am.archived_at IS NOT NULL) AS assignee_archived,
  t.space_id, s.name AS space_name,
  t.pool_id, p.name AS pool_name,
  t.inventory_item_id, i.name AS inventory_item_name,
  c.last_done_at,
  ${ACTOR_NAME('dm', 'du')} AS last_done_by_name,
  CASE
    WHEN c.last_done_at IS NULL THEN NULL
    ELSE c.last_done_at + make_interval(days => t.interval_days)
  END AS next_due_at,
  ${STATE} AS state,
  ${DAYS_OVERDUE} AS days_overdue`;

/*
 * Worst first, and "worst" is a sentence rather than a column.
 *
 * A due task above a scheduled one, the latest among the due ones first, then a
 * paused one last — the same shape the espaços list uses to put out-of-service
 * rooms at the bottom without hiding them. Title breaks the tie so a list does
 * not reshuffle itself between two identical reads.
 */
const TASK_ORDER = `
  ORDER BY
    CASE ${STATE} WHEN 'due' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
    ${DAYS_OVERDUE} DESC,
    t.title`;

interface TaskRow {
  total_count?: number;
  id: string;
  facility_id: string;
  facility_name: string;
  title: string;
  description: string | null;
  interval_days: number;
  active: boolean;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assignee_archived: boolean;
  space_id: string | null;
  space_name: string | null;
  pool_id: string | null;
  pool_name: string | null;
  inventory_item_id: string | null;
  inventory_item_name: string | null;
  last_done_at: Date | null;
  last_done_by_name: string | null;
  next_due_at: Date | null;
  state: TaskState;
  days_overdue: number;
}

function toTask(row: TaskRow): MaintenanceTask {
  return {
    id: row.id,
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    title: row.title,
    description: row.description,
    intervalDays: row.interval_days,
    active: row.active,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name,
    assigneeArchived: row.assignee_archived,
    spaceId: row.space_id,
    spaceName: row.space_name,
    poolId: row.pool_id,
    poolName: row.pool_name,
    inventoryItemId: row.inventory_item_id,
    inventoryItemName: row.inventory_item_name,
    // toISOString, never to_char: a hand-written offset is what put "Invalid
    // Date" on the invoice page.
    lastDoneAt: row.last_done_at?.toISOString() ?? null,
    lastDoneByName: row.last_done_by_name,
    nextDueAt: row.next_due_at?.toISOString() ?? null,
    state: row.state,
    daysOverdue: Number(row.days_overdue),
  };
}

/** Every task at one site, worst first. */
export async function listTasks(
  organizationId: string,
  facilityId: string,
): Promise<MaintenanceTask[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<TaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM maintenance_task t
         ${TASK_JOINS}
        WHERE t.facility_id = $1 AND t.archived_at IS NULL
        ${TASK_ORDER}`,
      [facilityId],
    );

    return rows.map(toTask);
  });
}

/**
 * What is mine, across every site — the roadmap's "a task appears for the right
 * person".
 *
 * **Unassigned tasks are included when `includeUnassigned` is set**, because a
 * job nobody has been given still has to be visible to somebody. The dashboard
 * asks for them; a personal list would not.
 *
 * Paused tasks are left out here and only here: this is a to-do list, and a
 * suspended job is not something to do today. The site's own list still shows
 * them, which is where somebody goes to resume one.
 */
export async function listMyTasks(
  organizationId: string,
  membershipId: string,
  includeUnassigned: boolean,
): Promise<MaintenanceTask[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<TaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM maintenance_task t
         ${TASK_JOINS}
        WHERE t.archived_at IS NULL
          AND t.active
          AND (t.assigned_to = $1 OR ($2::boolean AND t.assigned_to IS NULL))
        ${TASK_ORDER}`,
      [membershipId, includeUnassigned],
    );

    return rows.map(toTask);
  });
}

export async function getTask(
  organizationId: string,
  taskId: string,
): Promise<MaintenanceTask | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<TaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM maintenance_task t
         ${TASK_JOINS}
        WHERE t.id = $1 AND t.archived_at IS NULL`,
      [taskId],
    );

    const row = rows[0];
    return row === undefined ? null : toTask(row);
  });
}

/** Somebody a task can be given to, or something it can be about. */
export interface Option {
  id: string;
  name: string;
}

export interface TaskTarget extends Option {
  kind: 'space' | 'pool' | 'item';
}

/**
 * Who a task may be assigned to.
 *
 * **Shipped by the API rather than assembled by the screen, and complete.** The
 * people list is paginated, and a picker built from a page offers only the
 * people who happened to land on page 1 — the trap POOLSE-29 names beside the
 * ownership-transfer picker. This is a whole list because it is short by
 * construction: management logins, not the club's families.
 *
 * Archived memberships are out. A task already assigned to somebody who has left
 * keeps saying so — `assigneeArchived` — but they are not offered again.
 */
export async function listAssignees(organizationId: string): Promise<Option[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string | null }>(
      `SELECT DISTINCT m.id, ${ACTOR_NAME('m', 'u')} AS name
         FROM membership m
         JOIN membership_role r
           ON r.membership_id = m.id AND r.organization_id = m.organization_id
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE m.organization_id = $1
          AND m.archived_at IS NULL
          AND m.status = 'active'
          AND r.archived_at IS NULL
          AND r.role IN ('owner', 'admin', 'instructor', 'maintenance')
        ORDER BY name NULLS LAST`,
      [organizationId],
    );

    // A membership with no name at all is a half-finished invitation, and
    // offering it would put a blank line in the picker.
    return rows.flatMap((row) => (row.name === null ? [] : [{ id: row.id, name: row.name }]));
  });
}

/**
 * What a task at this site can be about.
 *
 * One query with three sources rather than three round trips, and complete for
 * the same reason the assignees are. Ordered by kind then name, so the picker
 * reads as three groups without the client sorting anything.
 */
export async function listTargets(
  organizationId: string,
  facilityId: string,
): Promise<TaskTarget[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<TaskTarget>(
      `SELECT 'space' AS kind, s.id, s.name
         FROM space s
        WHERE s.facility_id = $1 AND s.archived_at IS NULL
       UNION ALL
       SELECT 'pool' AS kind, p.id, p.name
         FROM pool p
        WHERE p.facility_id = $1 AND p.archived_at IS NULL
       UNION ALL
       SELECT 'item' AS kind, i.id, i.name
         FROM inventory_item i
        WHERE i.facility_id = $1 AND i.archived_at IS NULL
       ORDER BY kind, name`,
      [facilityId],
    );

    return rows;
  });
}

export interface TaskInput {
  facilityId: string;
  title: string;
  description: string | null;
  intervalDays: number;
  assignedTo: string | null;
  spaceId: string | null;
  poolId: string | null;
  inventoryItemId: string | null;
  active: boolean;
}

/**
 * Raised when a target names something that is not at this site.
 *
 * The composite keys refuse it — that is what they are for — and this turns the
 * refusal into a sentence. A 500 and a Postgres string is a message for whoever
 * wrote the migration.
 */
export class UnknownTargetError extends Error {}

function asTargetError<T>(error: unknown): T {
  // 23503 is one of the three MATCH SIMPLE keys through `facility_id`.
  if (error instanceof Error && (error as { code?: string }).code === '23503') {
    throw new UnknownTargetError('target');
  }
  throw error;
}

export async function addTask(
  organizationId: string,
  input: TaskInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx
      .query<{ id: string }>(
        `INSERT INTO maintenance_task
           (organization_id, facility_id, title, description, interval_days,
            assigned_to, space_id, pool_id, inventory_item_id, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          organizationId,
          input.facilityId,
          input.title,
          input.description,
          input.intervalDays,
          input.assignedTo,
          input.spaceId,
          input.poolId,
          input.inventoryItemId,
          input.active,
        ],
      )
      .catch((error: unknown) => asTargetError<{ rows: { id: string }[] }>(error));

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not create the task');

    await recordAudit(tx, {
      action: 'maintenance.taskCreated',
      entityType: 'maintenance_task',
      entityId: id,
      data: { title: input.title, intervalDays: input.intervalDays },
    });

    return id;
  });
}

/** Edit in place. The facility never moves — a task belongs to the site it names. */
export async function updateTask(
  organizationId: string,
  taskId: string,
  input: Omit<TaskInput, 'facilityId'>,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx
      .query<{ id: string }>(
        `UPDATE maintenance_task
            SET title = $2, description = $3, interval_days = $4,
                assigned_to = $5, space_id = $6, pool_id = $7,
                inventory_item_id = $8, active = $9
          WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
        [
          taskId,
          input.title,
          input.description,
          input.intervalDays,
          input.assignedTo,
          input.spaceId,
          input.poolId,
          input.inventoryItemId,
          input.active,
        ],
      )
      .catch((error: unknown) => asTargetError<{ rows: { id: string }[] }>(error));

    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'maintenance.taskUpdated',
      entityType: 'maintenance_task',
      entityId: taskId,
      data: { title: input.title, active: input.active },
    });

    return true;
  });
}

export async function archiveTask(
  organizationId: string,
  taskId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE maintenance_task SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id`,
      [taskId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'maintenance.taskArchived',
      entityType: 'maintenance_task',
      entityId: taskId,
      data: {},
    });

    return true;
  });
}

interface CompletionRow {
  total_count: number;
  id: string;
  performed_at: Date;
  performed_by_name: string | null;
  note: string | null;
}

export interface TaskCompletion {
  id: string;
  performedAt: string;
  performedByName: string | null;
  note: string | null;
}

/**
 * Record that the work was done.
 *
 * **`performedBy` is the server's, never the client's**, exactly as a cleaning's
 * is: a record of who did something that the doer can address to somebody else
 * is not a record. `performedAt` *may* be supplied, because a job done on
 * Saturday and typed in on Monday is the ordinary case and the whole due
 * calculation depends on when the work happened rather than when it was entered.
 */
export async function completeTask(
  organizationId: string,
  taskId: string,
  performedBy: string,
  performedAt: string | null,
  note: string | null,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: live } = await tx.query<{ id: string }>(
      `SELECT id FROM maintenance_task WHERE id = $1 AND archived_at IS NULL`,
      [taskId],
    );
    if (!live[0]) return null;

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO maintenance_task_completion
         (organization_id, task_id, performed_at, performed_by, note)
       VALUES ($1, $2, coalesce($3::timestamptz, now()), $4, $5)
       RETURNING id`,
      [organizationId, taskId, performedAt, performedBy, note],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not record the completion');

    await recordAudit(tx, {
      action: 'maintenance.taskCompleted',
      entityType: 'maintenance_task',
      entityId: taskId,
      data: { completionId: id },
    });

    return id;
  });
}

/** The history, newest first — slice 4.4's "who did what, when". */
export async function listCompletions(
  organizationId: string,
  taskId: string,
  page: PageQuery,
): Promise<Paginated<TaskCompletion>> {
  return withOrg(organizationId, async (tx) =>
    windowed<CompletionRow, TaskCompletion>(
      page,
      (limit, offset) =>
        tx.query<CompletionRow>(
          `SELECT ${TOTAL_COUNT},
                  tc.id, tc.performed_at,
                  ${ACTOR_NAME('m', 'u')} AS performed_by_name,
                  tc.note
             FROM maintenance_task_completion tc
             LEFT JOIN membership m
               ON m.id = tc.performed_by AND m.organization_id = tc.organization_id
             LEFT JOIN app_user u ON u.id = m.app_user_id
            WHERE tc.task_id = $1 AND tc.archived_at IS NULL
            ORDER BY tc.performed_at DESC, tc.id DESC
            LIMIT $2 OFFSET $3`,
          [taskId, limit, offset],
        ),
      (row) => ({
        id: row.id,
        performedAt: row.performed_at.toISOString(),
        performedByName: row.performed_by_name,
        note: row.note,
      }),
    ),
  );
}

/**
 * Remove a completion.
 *
 * There is no edit, for the reason a cleaning has none: an entry is a claim
 * about a moment, and editing one rewrites what a colleague said they did. A
 * mistake is deleted, and the task goes straight back to due if that was its
 * only completion — which is the only honest answer.
 */
export async function archiveCompletion(
  organizationId: string,
  completionId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; task_id: string }>(
      `UPDATE maintenance_task_completion SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, task_id`,
      [completionId],
    );
    const row = rows[0];
    if (!row) return false;

    await recordAudit(tx, {
      action: 'maintenance.completionArchived',
      entityType: 'maintenance_task',
      entityId: row.task_id,
      data: { completionId },
    });

    return true;
  });
}
