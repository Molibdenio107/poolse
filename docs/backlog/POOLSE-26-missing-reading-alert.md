# POOLSE-26 · Missing-reading alert

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Maintenance · **Priority:** Medium
**Borrowed from:** Pool Shark H2O and SILOE — both alert when a pool *hasn't* been tested, not only when a value is out of range.

### PO — why this exists

Every water-quality system alerts on a bad reading. None of the cheap ones alerts on a reading that never happened, which is the failure that actually closes pools and fails inspections. Maintenance staff get a nudge before the gap becomes a compliance hole; supervisors get an escalation instead of a surprise. Medium priority, shipping with the maintenance module.

**Not in scope:** out-of-range alerting, which already exists and stays independently configurable; automated readings from probes; the compliance report format itself.

### BA — rules and data

- Each basin has one or more **testing intervals**, configurable per parameter or per parameter group (e.g. pH and chlorine every 4 hours, combined chlorine daily).
- An interval elapsing with no reading for that parameter fires a **missing-reading alert**. This is a distinct alert type from out-of-range, with its own enable/disable and its own thresholds.
- Escalation is two-tier: the responsible staff member first; the supervisor after a configurable grace period with the reading still unlogged. The grace period is per interval configuration, not global.
- The interval clock restarts from the **timestamp of the reading**, not from when it was entered — a reading taken at 08:00 and logged at 11:00 restarts the clock at 08:00.
- Suppression rules: no alert fires for a basin on a closure date (POOLSE-31), for a basin marked out of season, or for a basin marked drained. A drained pool paging someone nightly is the specific failure the AC names.
- Recipients resolve by **role** (POOLSE-01 roles), not by named individuals, so staff turnover does not silently orphan an alert. Delivery via in-app and email; SMS optional per tenant.
- **Open-ish, decide explicitly:** if no Person currently holds the responsible role for a basin, the alert must escalate straight to the supervisor tier rather than vanishing.
- The dashboard shows, per basin, last tested timestamp, the interval, and whether it is within it — colour-coded, with the state also stated as text and the timestamp always visible (colour never alone).
- Alert history is retained as part of the compliance record: fired_at, basin, parameter, tier, recipients, acknowledged_by, acknowledged_at. Retention is indefinite unless a tenant retention policy says otherwise; it is not pruned with operational logs.
- Acknowledging an alert does not satisfy the interval — only a reading does. An acknowledged alert stops the notification; the basin stays out of interval until tested.

### Dev — implementation notes

- Migration: `basin_test_interval` (tenant, basin, parameter_or_group, interval, grace_period, responsible_role, supervisor_role, enabled), `maintenance_alert` history. Tenant key on all; index on (tenant_id, basin_id, parameter, reading_ts desc) for the last-reading lookup.
- Evaluation is a scheduled per-tenant job, idempotent, that computes due-ness from the last reading timestamp rather than from a stored "next due" field that drifts when a reading is backdated.
- Suppression is one shared predicate — `isBasinAlertable(basin, instant)` — consulted by both the missing-reading job and the out-of-range path, so closure and drained handling cannot diverge between them.
- Closure dates come from POOLSE-31 and are evaluated in the tenant's timezone. A closure defined as a date range must suppress the whole of each local day, not a UTC window offset by an hour.
- API: interval configuration is Owner/Admin only, enforced server-side; the dashboard is readable by Owner, Admin and Maintenance; Student, EE and Instructor get `403` on both. Acknowledgement is available to the responsible and supervisor roles.
- Notification fan-out resolves role → Persons at send time, deduplicating a Person who holds both tiers (POOLSE-17 union of roles) so one human does not get the same alert twice.
- i18n and theming: parameter names, alert copy and email templates in pt-PT and en; the dashboard's within-interval / overdue states need tokens checked in light and dark, plus a text label and the last-tested timestamp so colour is never the only signal.
- Most likely to be got wrong: restarting the interval clock from the entry time instead of the reading time, which makes a backdated reading look like a fresh one and silently hides a real gap.

### QA — test scenarios

26.1 Given a basin with a 4-hour pH interval and a reading at 08:00 / When 12:01 passes with no new reading / Then a missing-reading alert fires to the responsible role.
26.2 Given that alert and a grace period of 2 hours / When the reading is still absent at 14:01 / Then the supervisor is notified and the first-tier alert is not re-sent.
26.3 Given a reading taken at 08:00 but entered at 11:00 / When due-ness is evaluated / Then the clock runs from 08:00 and the alert fires at 12:00, not 15:00.
26.4 Given a closure covering today (POOLSE-31) / When the interval elapses / Then no alert fires for that basin.
26.5 Given a basin marked drained / When intervals elapse nightly for a week / Then no alert is sent on any night.
26.6 Given out-of-range alerting disabled and missing-reading alerting enabled / When a reading is skipped / Then the missing-reading alert still fires; and the reverse configuration behaves symmetrically.
26.7 Given an Instructor token / When it PATCHes a basin's testing interval / Then `403` and the configuration is unchanged.
26.8 Given a Student token / When it requests the maintenance dashboard / Then `403`.
26.9 Given a Person holding both the responsible and the supervisor role / When both tiers fire / Then they receive the alert once per tier at most, with no duplicate delivery within a tier.
26.10 Given no Person holds the responsible role for a basin / When the interval elapses / Then the alert escalates to the supervisor tier rather than being dropped.
26.11 Given an alert is acknowledged but no reading is entered / When the dashboard renders / Then the basin still shows as out of interval, and the acknowledgement is recorded in the alert history.
26.12 Given the pt-PT and en locales in light and dark mode / When the dashboard renders within-interval and overdue basins / Then both states are readable by text and timestamp alone, and contrast passes in both themes.

### Acceptance criteria

1. Each basin has a configurable testing interval (per parameter or per parameter group).
2. When an interval elapses with no reading, an alert fires — separate from, and independently configurable to, out-of-range alerting.
3. Two-tier escalation: the responsible staff member first, the supervisor if it remains unlogged after a configurable grace period.
4. Alerts reach the right people by their role (POOLSE-01 roles), via in-app and email; SMS optional.
5. A dashboard shows, per basin, when it was last tested and whether it is within interval — colour-coded.
6. Alerts respect closed dates and out-of-season basins; a pool that is drained does not page anyone nightly.
7. The alert history is retained as part of the compliance record.
