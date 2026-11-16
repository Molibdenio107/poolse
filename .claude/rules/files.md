---
paths:
  - "apps/api/src/files/**"
  - "apps/web/src/components/file-upload.tsx"
  - "apps/web/src/app/**/files/**"
  - "apps/web/src/**/files.actions.ts"
  - "apps/web/src/lib/{files,pending-file}.ts"
  - "apps/web/src/components/{document-upload,file-drop}.tsx"
---

# Files

- **File storage is R2 (S3Mock in dev), and a file is read only through the app.** 12 October
  2026. `stored_file` is the registry; `POST /files` takes raw bytes (purpose and name in the
  query), judges the type by its first bytes, 10 MB; a feature attaches the returned id with its
  own route, which re-checks the purpose in its transaction. `GET /files/:id` applies
  `RULES[purpose]` in `files/files.repository.ts` and streams; the web serves it at `/files/<id>`.
  Never a public bucket or a pre-signed link. Student photos (consent rule) and incident
  attachments (encrypted) are named in the enum and not switched on. Upload controls:
  `FileUpload` / `AttachedDocument` in `components/file-upload.tsx`. `docs/features/files.md`.
