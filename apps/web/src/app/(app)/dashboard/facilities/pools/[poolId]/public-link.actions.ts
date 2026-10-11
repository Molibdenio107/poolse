'use server';

import { revalidatePath } from 'next/cache';
import { apiDelete, apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../../actions';

/**
 * A tank's public page — POOLSE-71. Turn it on, give it a new link, switch it
 * off. Owner, admin and maintenance; the API refuses anybody else.
 */

export async function issuePublicLinkAction(
  organizationId: string,
  poolId: string,
  replace: boolean,
): Promise<FormState> {
  try {
    await apiPost(`/pools/${poolId}/public-link`, { replace }, { organizationId });
  } catch (error) {
    return describeFailure(error, 'publicWater.manage.error');
  }
  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

export async function revokePublicLinkAction(
  organizationId: string,
  poolId: string,
): Promise<FormState> {
  try {
    await apiDelete(`/pools/${poolId}/public-link`, { organizationId });
  } catch (error) {
    return describeFailure(error, 'publicWater.manage.error');
  }
  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}
