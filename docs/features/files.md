# Files — photographs, documents and the logo

Built 12 October 2026. What a club can upload, who can see it, and how it is kept.

## What can be uploaded

| Where | What | Who uploads | Who can open it |
|---|---|---|---|
| A site's page and the Instalações list | Photographs of the site | Owner, admin | Every member, families included (since 15-10-2026) |
| A tank's page | Photographs of the tank | Owner, admin | All staff |
| A site's page → Fotografias, above the site's photographs (POOLSE-104; Dados do clube 13–23-10-2026, Faturação before) | The club's logo, shown in the top corner of every screen beside the club's name and at the head of a printed invoice | Owner, admin | Every member, families included |
| A site's apólices (Seguros) | The policy document, one per apólice, replaceable | Owner, admin | Owner, admin |
| A partnership's Acordo tab | The signed contract, from the partner's first day; PDF, Word or a photograph; earlier versions kept (POOLSE-105) | Owner, admin | All staff (since 23-10-2026) |
| A staff member's qualifications | The scanned certificate, one per record, **attached once** | Owner, admin | Owner, admin, and the person it certifies |
| A student's page, beside the name (28-10-2026) | The student's photograph — **only with a photo consent** granted and not withdrawn | Owner, admin | All staff and the child's own family, while the consent stands; a withdrawal hides it at once |
| A staff member's page, inside the person's card (28-10-2026) | The photograph of somebody **with no login** | Owner, admin | All staff |
| *O meu perfil* (28-10-2026) | Your own photograph. It is Clerk's, like your name: the avatar at the top right, in every club | You | Wherever your avatar shows |

**Not yet:** the identity document on a student's page, and incident attachments (health
data, which need encryption). Those controls stay visibly disabled.

**A person's photograph** sits in one square beside their name (`IdPhoto`,
`components/id-photo.tsx`), with *Carregar fotografia* / *Alterar* / *Remover* for whoever may
change it and the reason in words for anybody who may not. A student's is refused without a
photo consent (409 `photo_no_consent`); a staff member with a login sets their own, and the
office is told so (409 `photo_is_theirs`). Your own goes to Clerk through `PUT /me/photo`, and
the cache is re-read from Clerk, never written from the upload. A face is shrunk to 800 px.

## Rules

- **10 MB a file. PDF, JPEG, PNG or WebP**, judged by the file's first bytes, never its name.
  A photograph or a logo must be an image. **A partnership's contract may also be Word
  (.docx)** — a ZIP whose parts include `word/document.xml`, so a .pptx or .xlsx is refused —
  and only a contract: the schema's CHECK says so too. A Word file is served as a download
  under its own name; everything else opens in the browser.
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
