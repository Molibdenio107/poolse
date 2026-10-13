# Files — photographs, documents and the logo

Built 12 October 2026. What a club can upload, who can see it, and how it is kept.

## What can be uploaded

| Where | What | Who uploads | Who can open it |
|---|---|---|---|
| A site's page and the Instalações list | Photographs of the site | Owner, admin | All staff |
| A tank's page | Photographs of the tank | Owner, admin | All staff |
| A site's page → Dados do clube (with the NIPC; under Faturação until 13-10-2026) | The club's logo, shown in the top corner of every screen beside the club's name | Owner, admin | Every member, families included |
| A site's apólices (Seguros) | The policy document, one per apólice, replaceable | Owner, admin | Owner, admin |
| A partnership's Acordo tab | The signed contract, on the agreement in force | Owner, admin | Owner, admin |
| A staff member's qualifications | The scanned certificate, one per record, **attached once** | Owner, admin | Owner, admin, and the person it certifies |

**Not yet:** student photographs (they wait for the photo-consent rule: staff and the family,
only with consent), the identity document on a student's page, and incident attachments
(health data, which need encryption). Those controls stay visibly disabled.

## Rules

- **10 MB a file. PDF, JPEG, PNG or WebP**, judged by the file's first bytes, never its name.
  A photograph or a logo must be an image.
- **Photographs are shrunk in the browser** before they are sent (longest edge 2000 px; a
  logo 1000 px), so a phone picture becomes a few hundred KB.
- **A file is only ever opened through the app** (`/files/<id>`), which asks the API, which
  checks the reader's role for that kind of file on every request. There are no public or
  shareable links, and another club's file id answers "not found".
- **Nothing is deleted.** Removing a photograph takes it out of the gallery; replacing or
  removing a document unhooks it. The file and its upload stay on record, and every upload,
  attachment and removal is in the audit log.
- **A certificate is attached once.** A different scan is a different qualification record,
  so the history stays true.
- **No storage configured** (a fresh development machine, or before the bucket is set up):
  every upload control stays visible, switched off, and says why.

## Where it lives

Cloudflare R2 in staging and production; S3Mock in development (`docker compose up -d storage`).
Configuration is six `S3_*` variables on the API — `.env.example` lists them. Schema:
`stored_file` in `docs/data-model.md`.
