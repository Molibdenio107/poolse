import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Put } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import {
  moveWizard,
  ONBOARDING_STEPS,
  readWizard,
  type OnboardingStep,
  type StepOutcome,
  type WizardState,
} from './onboarding.repository.js';

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
}
