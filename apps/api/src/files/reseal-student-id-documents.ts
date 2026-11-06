/**
 * Re-seals the student ID photographs filed before POOLSE-179 — run once per
 * environment, by hand.
 *
 *   pnpm --filter @poolse/api build
 *   node --env-file=../../.env dist/files/reseal-student-id-documents.js          # dry run: lists, changes nothing
 *   node --env-file=../../.env dist/files/reseal-student-id-documents.js --apply  # does it
 *
 * Until the 1794653000000 migration, an ID photo was a plain `student_document`
 * file: the bucket held a readable copy of a child's identity card. For each
 * such file this script, one at a time:
 *
 * 1. reads the plaintext, seals it under a new id (`sealFile`), and checks the
 *    sealed copy opens back to the same bytes before going on;
 * 2. writes the sealed object, then in one transaction registers it as a
 *    `student_id_document`, points the `student_document` row at it (the
 *    `student_document_id_sealed` trigger checks the purpose), archives the old
 *    row and audits `file.resealed`;
 * 3. only after that commits, **deletes the plaintext object**. That step cannot
 *    be undone, which is why the default is a dry run.
 *
 * Idempotent: a row already on a sealed file is not a candidate, and a run
 * stopped half-way picks up the rest. A failure on one file is reported and the
 * others continue; a sealed object written for a transaction that then failed is
 * an unreachable orphan (ciphertext), named in the output.
 *
 * Runs as the owner (`DATABASE_URL`), because it walks every club; each write
 * still sets the club's own tenant context.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { fileContext, openSealedFile, sealFile } from '../sensitive/envelope.js';
import { deleteObject, getObjectBytes, putObject, storageConfigured } from './storage.js';

interface Candidate {
  document_id: string;
  organization_id: string;
  student_id: string;
  file_id: string;
  storage_key: string;
  content_type: string;
  byte_size: number;
  original_name: string;
  uploaded_by: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!storageConfigured()) throw new Error('Storage is not configured (S3_*)');
  if (!process.env['SENSITIVE_DATA_KEY']) throw new Error('SENSITIVE_DATA_KEY is not set');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<Candidate>(
      `SELECT d.id AS document_id, d.organization_id, d.student_id, f.id AS file_id, f.storage_key,
              f.content_type, f.byte_size, f.original_name, f.uploaded_by
         FROM student_document d
         JOIN stored_file f ON f.organization_id = d.organization_id AND f.id = d.file_id
        WHERE d.kind::text = 'id_document'
          AND f.purpose::text = 'student_document'
        ORDER BY d.organization_id, d.filed_at`,
    );
    console.log(`${rows.length} plaintext ID photograph(s) to re-seal${apply ? '' : ' (dry run: nothing changes)'}.`);
    if (!apply) {
      for (const row of rows) console.log(`  ${row.organization_id}  document ${row.document_id}  ${row.byte_size} bytes`);
      return;
    }

    let done = 0;
    for (const row of rows) {
      const id = randomUUID();
      const key = `${row.organization_id}/student_id_document/${id}.sealed`;
      try {
        const plain = await getObjectBytes(row.storage_key);
        const sealed = sealFile(plain, fileContext(row.organization_id, id));
        const check = openSealedFile(sealed.body, sealed.wrappedKey, fileContext(row.organization_id, id));
        if (!check.equals(plain)) throw new Error('the sealed copy did not open to the same bytes');
        await putObject(key, sealed.body, 'application/octet-stream');

        await client.query('BEGIN');
        try {
          await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', row.organization_id]);
          await client.query(
            `INSERT INTO stored_file (id, organization_id, purpose, storage_key, content_type, byte_size,
                                      original_name, uploaded_by, wrapped_key)
             VALUES ($1, $2, 'student_id_document'::file_purpose, $3, $4, $5, $6, $7, $8)`,
            [id, row.organization_id, key, row.content_type, plain.length, row.original_name, row.uploaded_by, sealed.wrappedKey],
          );
          await client.query('UPDATE student_document SET file_id = $1 WHERE id = $2', [id, row.document_id]);
          await client.query('UPDATE stored_file SET archived_at = coalesce(archived_at, now()) WHERE id = $1', [row.file_id]);
          await client.query(
            `INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
             VALUES ($1, 'file.resealed', 'student', $2, $3::jsonb)`,
            [row.organization_id, row.student_id, JSON.stringify({ from: row.file_id, to: id, ticket: 'POOLSE-179' })],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`  orphaned sealed object ${key} (ciphertext, unreachable)`);
          throw error;
        }

        // Committed: the plaintext copy goes. Irreversible.
        await deleteObject(row.storage_key);
        done += 1;
        console.log(`  re-sealed document ${row.document_id}`);
      } catch (error) {
        console.error(`  FAILED document ${row.document_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`${done} of ${rows.length} re-sealed.`);
    if (done < rows.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
