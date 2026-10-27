import { apiFetch } from '@/lib/api';
import { PushSwitch } from './push-switch';

/**
 * The push switch with the server's answer to "is push on here at all" —
 * POOLSE-90 slice 4. A failure to ask is the same as off: the switch then says
 * notifications are not available, never errors.
 */
export async function PushCard(): Promise<React.ReactElement> {
  const config = await apiFetch<{ available: boolean; publicKey: string | null }>('/push/config').catch(() => ({
    available: false,
    publicKey: null,
  }));
  return <PushSwitch available={config.available} publicKey={config.publicKey} />;
}
