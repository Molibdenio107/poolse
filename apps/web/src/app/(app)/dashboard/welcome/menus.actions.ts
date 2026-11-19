'use server';

import { redirect } from 'next/navigation';
import { apiPut } from '@/lib/api';

/**
 * *Ir para o painel* while the setup is under way (Rui, 19-11-2026): the menus
 * come back, on the Owner's account, then the Painel opens. The API answers the
 * Owner only and writes their own row. A failure still opens the Painel — the
 * menus stay hidden, and the button is there to press again.
 */
export async function showMenusAction(): Promise<void> {
  await apiPut('/onboarding/menus', {}).catch(() => undefined);
  redirect('/dashboard');
}
