import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Put } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, MEMBER_ROLES, requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import {
  moveWizard,
  ONBOARDING_STEPS,
  readWizard,
  type OnboardingStep,
  type StepOutcome,
  type WizardState,
} from './onboarding.repository.js';
import { readChecklist, recordTour, setChecklistDismissed, type Checklist } from './checklist.repository.js';

const OUTCOMES: readonly StepOutcome[] = ['done', 'skipped', 'open'];

/**
 * The Owner's setup after creating a club — POOLSE-228 (Rui, 19-11-2026).
 *
 * **The Owner's own, and only their own row.** Every route refuses anybody but
 * the Owner in its first line, and the row is the session's membership, never an
 * id from the body. Core: setting up a club is not a module a club buys.
 *
 * These routes move a pointer and nothing else; each step saves through the
 * screen that owns its setting.
 */
@CoreRoute()
@Controller('onboarding')
export class OnboardingController {
  /** Null `wizard` is "no wizard here": a club from before, or one finished. */
  @Get()
  async read(): Promise<{ wizard: WizardState | null }> {
    requireRole('owner');
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();
    return { wizard: await readWizard(organizationId, membershipId) };
  }

  @Put('step')
  async step(@Body() body: Record<string, unknown>): Promise<{ wizard: WizardState }> {
    requireRole('owner');
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();

    const step = body['step'];
    const outcome = body['outcome'];
    if (typeof step !== 'string' || !(ONBOARDING_STEPS as readonly string[]).includes(step)) {
      throw new BadRequestException({ code: 'invalid_step', message: 'Unknown step' });
    }
    if (typeof outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(outcome)) {
      throw new BadRequestException({ code: 'invalid_outcome', message: 'outcome is done, skipped or open' });
    }

    const wizard = await moveWizard(organizationId, membershipId, step as OnboardingStep, outcome as StepOutcome);
    if (wizard === null) throw new NotFoundException({ code: 'no_wizard', message: 'There is no setup to continue' });
    return { wizard };
  }

  /**
   * *Vamos começar* — POOLSE-229. The Owner's, and an Admin's to read (every
   * item but the public form is theirs to do too); only the Owner dismisses.
   * Null `checklist` is a club the list does not apply to (a personal pool).
   */
  @Get('checklist')
  async checklist(): Promise<{ checklist: Checklist | null; canDismiss: boolean }> {
    requireRole('owner', 'admin');
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();
    return { checklist: await readChecklist(organizationId, membershipId), canDismiss: hasRole('owner') };
  }

  @Put('checklist')
  async dismissChecklist(@Body() body: Record<string, unknown>): Promise<{ dismissed: boolean }> {
    requireRole('owner');
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();
    if (typeof body['dismissed'] !== 'boolean') {
      throw new BadRequestException({ code: 'invalid_dismissed', message: 'dismissed is true or false' });
    }
    await setChecklistDismissed(organizationId, membershipId, body['dismissed']);
    return { dismissed: body['dismissed'] };
  }

  /**
   * The guided tour's outcome — POOLSE-230. **Every member, for their own row**:
   * a family and a teacher take the tour too, and the row is the session's
   * membership, never an id from the body.
   */
  @Put('tour')
  async tour(@Body() body: Record<string, unknown>): Promise<{ recorded: true }> {
    requireRole(...MEMBER_ROLES);
    const { organizationId, membershipId } = currentTenant();
    if (!membershipId) throw new ForbiddenException();
    const outcome = body['outcome'];
    if (outcome !== 'finished' && outcome !== 'dismissed') {
      throw new BadRequestException({ code: 'invalid_outcome', message: 'outcome is finished or dismissed' });
    }
    await recordTour(organizationId, membershipId, outcome);
    return { recorded: true };
  }
}
