import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { IMPORT_FIELDS, MAX_IMPORT_ROWS, type ImportField, type RawImportRow } from './import.js';
import { runImport, type ImportResult } from './import.repository.js';

/**
 * Slice 1.10 — the import endpoint.
 *
 * **One route, a `commit` flag.** A separate `/preview` would be a second code
 * path that validates "the same way" right up to the evening it does not, and
 * the failure mode is the worst one this feature has: an operator approves a
 * preview and a different set of rows is written. So preview and commit are the
 * same request with one boolean changed, and they run the same function.
 *
 * Its own controller rather than a method on `StudentsController`, following
 * `LevelsController`: nothing here shares a shape with `/students/:id`, and a
 * literal segment sitting beside a parameter is a footgun that fires the day
 * somebody reorders the methods.
 *
 * The spreadsheet never reaches here. The web app reads the file and maps the
 * columns; this takes rows already keyed by Poolse's field names, because a file
 * format is transport and this is the rule.
 */
@Controller('students/import')
export class StudentImportController {
  @Post()
  async run(@Body() body: Record<string, unknown>): Promise<ImportResult> {
    // Creating students is owner/admin on the form, so it is owner/admin in
    // bulk. An import that took a role the single create refuses would be the
    // whole permission model, worked around by uploading a file.
    requireRole('owner', 'admin');
    const { organizationId } = currentTenant();

    return runImport(organizationId, {
      rows: readRows(body['rows']),
      commit: body['commit'] === true,
      include: readInclude(body['include']),
    });
  }
}

const FIELDS = new Set<string>(IMPORT_FIELDS);

/**
 * The rows, believed only as far as their shape.
 *
 * Unknown keys are dropped rather than refused: the client sends what the
 * operator mapped, and a field this API gained yesterday reaching a deployment
 * that has not shipped it should ignore the column, not reject the import.
 * Every value is coerced to a string, because a spreadsheet cell is text by the
 * time anybody has an opinion about it and `parseImportDate` is where numbers
 * are understood.
 */
function readRows(raw: unknown): RawImportRow[] {
  if (!Array.isArray(raw)) throw new BadRequestException('rows must be a list');
  if (raw.length === 0) throw new BadRequestException('rows is empty');
  if (raw.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(`at most ${MAX_IMPORT_ROWS} rows in one import`);
  }

  return raw.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException('each row must be an object of field to value');
    }

    const row: RawImportRow = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!FIELDS.has(key)) continue;
      if (value === null || value === undefined) continue;
      row[key as ImportField] = typeof value === 'string' ? value : String(value);
    }
    return row;
  });
}

/** Row indexes, or null when the caller expressed no selection at all. */
function readInclude(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new BadRequestException('include must be a list of row indexes');

  return raw.map((value) => {
    const index = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_IMPORT_ROWS) {
      throw new BadRequestException('include must hold row indexes');
    }
    return index;
  });
}
