import { Controller, Get, Query } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { readSearch } from '../common/search.js';
import { exportStudents, MAX_EXPORT_ROWS, type Student } from './students.repository.js';

/**
 * Slice 1.11 — data leaving.
 *
 * The roadmap's reason is one sentence and it is the right one: nobody trusts a
 * system data cannot leave. An export is not a feature for the day somebody
 * quits — it is the thing that makes committing to the product reasonable in the
 * first place.
 *
 * **`/exports/students` rather than `/students/export`.** The second sits in the
 * same space as `/students/:id`, and which one answers depends on the order the
 * routes were registered — a footgun that fires the day somebody reorders a
 * file. `LevelsController` dodged the identical problem the identical way. It
 * also gives the exports that follow — turmas, presenças — an obvious home.
 *
 * **What is deliberately not here: anything from `student_sensitive`.** Medical
 * notes are special-category data with their own table, their own access rule
 * and their own read log. A spreadsheet is exactly where that guarantee would
 * quietly end, because a file cannot be un-sent. Photographs are absent for the
 * same reason and one more: consent can be withdrawn, and a copy in somebody's
 * downloads folder cannot hear about it.
 */
@Controller('exports')
export class ExportsController {
  @Get('students')
  async students(
    @Query('search') search?: string,
    @Query('levelId') levelId?: string,
  ): Promise<{ students: Student[]; total: number; capped: boolean; max: number }> {
    /*
     * The same roles as the import, and for a stronger reason. This hands over
     * every child's name, birth date and a family telephone number in one file.
     * An instructor's own turmas are a different, narrower question, and 1.12 is
     * where it gets answered.
     */
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    const students = await exportStudents(organizationId, {
      // Read exactly as the list reads it, so a term too short to filter the
      // screen is too short to filter the file — POOLSE-30.
      search: readSearch(search),
      levelId: levelId?.trim() ? levelId.trim() : null,
    });

    return {
      students,
      total: students.length,
      // Recorded in the audit entry and handed to the caller, so a file that
      // stopped at the cap can be known to have stopped rather than being
      // quietly incomplete. No club is near it; the flag is what makes that
      // claim checkable instead of assumed.
      capped: students.length === MAX_EXPORT_ROWS,
      max: MAX_EXPORT_ROWS,
    };
  }
}
