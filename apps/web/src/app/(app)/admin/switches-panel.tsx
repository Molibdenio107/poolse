import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type PlatformSwitch } from '@/lib/api';
import { PageError } from '@/components/page-shell';
import { describeLoad } from '@/lib/load-failure';
import { anthropicKeyConfigured } from '@/lib/id-document-agent';
import { SwitchToggle } from './switch-toggle';

/**
 * Plataforma — platform-wide switches (Rui, 30-10-2026). One today: reading a
 * student's ID photo with the model. Each row says whether it is on, and
 * whether this server holds the key it needs, because a switch that is on with
 * no key reads nothing and must not look as though it does.
 */
export async function SwitchesPanel(): Promise<React.ReactElement> {
  const t = await getTranslations();
  let switches: PlatformSwitch[];
  try {
    switches = await apiFetch<PlatformSwitch[]>('/platform/switches');
  } catch (error) {
    // Somebody who is not an operator goes back to their club, as on Clientes.
    if (error instanceof ApiError && error.code === 'not_platform_admin') redirect('/dashboard');
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} detail={failure.detail} />;
  }
  const keyed = anthropicKeyConfigured();

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <ul className="flex flex-col divide-y divide-border">
        {switches.map((one) => (
          <li key={one.name} className="py-3 first:pt-0 last:pb-0">
            <SwitchToggle
              name={one.name}
              enabled={one.enabled}
              changedAt={one.changedAt}
              keyConfigured={keyed}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
