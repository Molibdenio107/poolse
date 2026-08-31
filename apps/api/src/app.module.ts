import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ClerkAuthMiddleware } from './auth/clerk-auth.middleware.js';
import { AttendanceController } from './classes/attendance.controller.js';
import { SeasonsController } from './classes/seasons.controller.js';
import {
  GuardiansController,
  PeopleDedupController,
  PeopleSearchController,
  AdvancementController,
  RedemptionController,
} from './students/students.controller.js';
import { SkillsController } from './classes/skills.controller.js';
import { StaffController } from './staff/staff.controller.js';
import { ClassesController, TimetableController } from './classes/classes.controller.js';
import {
  CalendarController,
  ClosuresController,
  SessionsCalendarController,
  StudentCalendarController,
} from './classes/sessions.controller.js';
import { FacilitiesController } from './facilities/facilities.controller.js';
import { HealthController } from './health/health.controller.js';
import { MeController } from './identity/me.controller.js';
import { SessionsController } from './identity/sessions.controller.js';
import { InvitationsController } from './invitations/invitations.controller.js';
import { JoinController } from './invitations/join.controller.js';
import { PeopleController } from './invitations/people.controller.js';
import {
  OrganizationsController,
  SettingsController,
} from './organizations/organizations.controller.js';
import { SensitiveController } from './sensitive/sensitive.controller.js';
import { RecordsController } from './students/records.controller.js';
import { LevelsController, StudentsController } from './students/students.controller.js';
import { StudentImportController } from './students/import.controller.js';
import { ExportsController } from './students/export.controller.js';
import { TenantMiddleware } from './tenant/tenant.middleware.js';
import { VacationsController } from './vacations/vacations.controller.js';
import { PlacesController, WeatherController } from './weather/weather.controller.js';
import { ClerkWebhookController } from './webhooks/clerk-webhook.controller.js';

/** Public: no session token expected. Health is for the platform, webhooks authenticate by signature. */
const PUBLIC_ROUTES = ['health', 'webhooks/(.*)'] as const;

/**
 * Authenticated, but with no tenant to resolve — every one of these answers a
 * question that comes *before* membership exists:
 *
 *   me            which organizations are there to be scoped to?
 *   me/preferences my own language and theme, which are mine before they are
 *                 any organization's
 *   organizations create the first one, when you belong to none
 *   join          redeem an invitation into an organization you are not in yet
 *
 * This list should stay short and each addition should be arguable in one
 * sentence. Everything else in the API runs tenant-scoped.
 */
const IDENTITY_ONLY_ROUTES = ['me', 'me/(.*)', 'organizations', 'join', 'join/(.*)'] as const;

@Module({
  controllers: [
    HealthController,
    MeController,
    SessionsController,
    ClerkWebhookController,
    OrganizationsController,
    SettingsController,
    RedemptionController,
    AdvancementController,
    PeopleController,
    InvitationsController,
    FacilitiesController,
    ClassesController,
    TimetableController,
    ClosuresController,
    CalendarController,
    SessionsCalendarController,
    AttendanceController,
    SeasonsController,
    PeopleSearchController,
    GuardiansController,
    PeopleDedupController,
    StudentImportController,
    ExportsController,
    SkillsController,
    StaffController,
    StudentCalendarController,
    StudentsController,
    LevelsController,
    SensitiveController,
    WeatherController,
    PlacesController,
    VacationsController,
    RecordsController,
    JoinController,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Default-deny shape: the middleware applies to everything, and public routes
    // are excluded one at a time. The opposite arrangement — listing the routes
    // that need tenancy — leaves every new endpoint unprotected until someone
    // remembers to add it.
    consumer
      .apply(ClerkAuthMiddleware)
      .exclude(...PUBLIC_ROUTES)
      .forRoutes('*');

    // Tenancy is a second, narrower ring inside authentication.
    consumer
      .apply(TenantMiddleware)
      .exclude(...PUBLIC_ROUTES, ...IDENTITY_ONLY_ROUTES)
      .forRoutes('*');
  }
}
