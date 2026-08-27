# POOLSE-27 · Certification expiry with amber window

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** People / Staff · **Priority:** Medium
**Borrowed from:** OpsPal — green / amber / red staff qualification tracking with a 90-day amber window.

### PO — why this exists

A lapsed lifeguard certificate is not an administrative detail; without a valid one the pool cannot open. Tracking qualifications as a status alone tells you the day it is too late. An amber window turns it into something the office can act on with three months' notice. Owners and Admins benefit, and the staff member gets warned about their own certificate. Medium priority, shipping with the People work.

**Not in scope:** booking or paying for renewal courses; a national qualification registry integration; blocking pool opening — this ticket flags, it does not enforce operations.

### BA — rules and data

- A qualification is a record on a **Person** (POOLSE-17), not on a role assignment: type, issuing body, issue date, expiry date, document upload. One Person may hold several, including two of the same type across renewals.
- Status is **derived, never stored**: verde (expiry > today + window), âmbar (today ≤ expiry ≤ today + window), vermelho (expiry < today). Same reasoning as POOLSE-33's brackets — a stored status ages wrong.
- The amber window is configurable, default 90 days, per tenant. **Open-adjacent, decide explicitly:** whether it is also overridable per qualification type — a first-aid certificate and a lifeguard licence have different renewal lead times. Implement per tenant with an optional per-type override.
- A qualification with no expiry date (some are lifetime) is always verde and never notifies. Do not treat a null expiry as expired.
- Renewal: adding a new record of the same type with a later expiry supersedes the old one for status purposes; the old record is retained for history, not deleted. The Person's status for that type is the latest expiry.
- Document uploads use the same private-storage handling as POOLSE-11: no public URLs, short-lived signed links, and every view or download audit-logged.
- Optional per-qualification rule: an instructor whose required qualification is vermelho cannot be **assigned to new turmas**; existing assignments are flagged, not severed. Removing an instructor mid-época from a class of children is worse than flagging it.
- That assignment block interacts with POOLSE-19: a transfer proposal must not rank a turma whose instructor is blocked — or if it does, the confirmation must surface the flag rather than fail opaquely.
- Notifications fire at the amber threshold (once, on crossing) and again on expiry, to the Person and to Owner/Admin. Crossing is evaluated daily; a window change that puts someone newly into amber notifies them on the next evaluation.
- Qualification types are tenant-configurable — the list differs by country and by role. Types are tenant data, so type names are never translated; only the status words and UI chrome are.

### Dev — implementation notes

- Migration: `qualification_type` (tenant-configurable, with optional per-type amber window), `qualification` (tenant, person, type, issuing_body, issue_date, expiry_date, document_ref), tenant amber-window setting. Tenant key on all; index on (tenant_id, expiry_date) for the amber/red report.
- Status derivation lives in one shared function taking (expiry, today, window) and is used by the report, the Person page, the assignment check and the notification job. Never compute it inline in a query in one place and in TypeScript in another.
- The daily evaluation job is idempotent and records which notifications it has already sent per (qualification, threshold), so a re-run does not re-notify.
- API: `GET /qualifications/expiring?status=amber,red` sorted by expiry, paginated at 15 (POOLSE-29). Write access is Owner/Admin; a Person may read their own qualifications. Instructor reading another Person's qualification documents gets `403`.
- The assignment block is enforced on the turma-assignment endpoint server-side, and its result is exposed to POOLSE-19's proposal ranking through the same helper rather than duplicated.
- Document access: signed links only, generated per request with a short expiry, and every access written to the audit log with actor, person, timestamp — identical handling to POOLSE-11, ideally the same storage service call.
- i18n and theming: verde/âmbar/vermelho are status keys with pt-PT and en labels; the status text and the expiry date are always rendered beside the colour token. Tokens checked in light and dark, and kept clear of the attendance palette (POOLSE-13) so âmbar does not read as *falta justificada*.
- Most likely to be got wrong: computing amber against a stored status or a cached "days remaining" value, so the dashboard is correct on the day it renders and quietly wrong a week later.

### QA — test scenarios

27.1 Given a qualification expiring in 200 days and a 90-day window / When the report renders / Then the status is verde and it is absent from the amber/red list.
27.2 Given a qualification expiring in exactly 90 days / When status is derived / Then it is âmbar, and at 91 days it is verde — the boundary is inclusive at the window edge.
27.3 Given a qualification expiring yesterday / When status is derived / Then it is vermelho, and the person appears at the top of the report sorted by expiry.
27.4 Given a qualification with no expiry date / When status is derived / Then it is verde and no notification is ever sent for it.
27.5 Given an instructor with a vermelho required qualification / When an Owner assigns them to a new turma via the API / Then the request is rejected, and their existing turma assignments remain in place but flagged.
27.6 Given that same instructor / When POOLSE-19 ranks candidate turmas / Then their turma is either excluded or the block is surfaced at confirmation, never failing silently.
27.7 Given an Instructor token / When it requests another Person's qualification document / Then `403`.
27.8 Given an Owner downloads a qualification document / When the download completes / Then the access is audit-logged with actor, person and timestamp, and the link expires shortly afterwards.
27.9 Given a renewal added with a later expiry / When the Person page renders / Then the status reflects the new expiry, the old record is still listed in history, and nothing was deleted.
27.10 Given the amber window is changed from 90 to 120 days / When the daily job next runs / Then people newly inside the window are notified once, and people already notified are not notified again.
27.11 Given the daily job runs twice on the same day / When notifications are evaluated / Then no duplicate notification is sent.
27.12 Given the pt-PT and en locales in light and dark mode / When verde, âmbar and vermelho appear together / Then each carries its status text and expiry date, contrast passes in both themes, and âmbar is not confusable with the attendance orange.

### Acceptance criteria

1. Qualifications are records on a Person: type, issuing body, issue date, expiry date, document upload (stored privately, same handling as POOLSE-11).
2. Status is derived and colour-coded: **verde** (current), **âmbar** (expires within a configurable window, default 90 days), **vermelho** (expired).
3. Colour never carries the meaning alone — status text and the expiry date are always shown.
4. A dashboard/report lists everyone in amber or red, sorted by expiry date.
5. Notifications at the amber threshold and again on expiry, to the person and to Owner/Admin.
6. Optional per-qualification rule: an instructor with an expired required qualification cannot be assigned to new turmas, and existing assignments are flagged.
7. Qualification types are tenant-configurable — the list differs by country and by role.
