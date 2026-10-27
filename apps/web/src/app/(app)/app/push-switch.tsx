'use client';

import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { subscribePushAction, unsubscribePushAction } from './push.actions';

type Status =
  | 'checking'
  /** VAPID keys absent on the server — push is off for everybody. */
  | 'unavailable'
  /** This browser has no push at all. */
  | 'unsupported'
  /** iPhone in Safari, not on the home screen: push needs the installed app. */
  | 'install'
  /** The person blocked notifications for Poolse. */
  | 'blocked'
  | 'off'
  | 'on';

/**
 * *Avisos neste telemóvel* — POOLSE-90 slice 4.
 *
 * **The permission prompt is raised only by tapping the switch**, never on load:
 * iOS refuses a prompt nobody asked for, and every platform punishes one. On an
 * iPhone that has not added Poolse to the home screen, push cannot work at all,
 * so the switch says how instead of asking. A switch (`role="switch"`) whose
 * state is said in words beside it, never by colour alone.
 *
 * Push is a second channel: the same notice is emailed whatever this says.
 */
export function PushSwitch({ available, publicKey }: { available: boolean; publicKey: string | null }): React.ReactElement {
  const t = useTranslations();
  const [status, setStatus] = useState<Status>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await currentStatus(available);
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [available]);

  const toggle = async (): Promise<void> => {
    if (busy || publicKey === null) return;
    setBusy(true);
    try {
      if (status === 'on') {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await unsubscribePushAction(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setStatus('off');
        return;
      }
      // The one place permission is asked: the person just tapped "on".
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const saved = await subscribePushAction({
        endpoint: json.endpoint ?? subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        label: deviceLabel(),
      });
      if (!saved.ok) {
        await subscription.unsubscribe();
        setStatus('off');
        return;
      }
      setStatus('on');
    } catch {
      setStatus(await currentStatus(available));
    } finally {
      setBusy(false);
    }
  };

  const interactive = status === 'on' || status === 'off';
  const sentence =
    status === 'checking'
      ? null
      : status === 'on'
        ? t('app.push.on')
        : status === 'off'
          ? t('app.push.off')
          : t(`app.push.${status}`);

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-medium">
          <BellRing className="size-4" aria-hidden />
          {t('app.push.title')}
        </span>
        {interactive && (
          <button
            type="button"
            role="switch"
            aria-checked={status === 'on'}
            aria-label={t('app.push.title')}
            disabled={busy}
            onClick={() => void toggle()}
            className={cn(
              'relative inline-flex h-control w-[calc(var(--control-h)*1.75)] shrink-0 items-center rounded-full border px-1 transition-colors disabled:opacity-60',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              status === 'on' ? 'border-primary bg-primary' : 'border-border bg-surface-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'block size-[calc(var(--control-h)-0.75rem)] rounded-full bg-surface shadow transition-transform',
                status === 'on' && 'translate-x-[calc(var(--control-h)*0.75)]',
              )}
            />
          </button>
        )}
      </div>
      {sentence !== null && <p className="text-sm text-foreground-muted">{sentence}</p>}
    </section>
  );
}

async function currentStatus(available: boolean): Promise<Status> {
  if (!available) return 'unavailable';
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (iOS && !installed) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

/** "iPhone · Safari" — so a person can tell their own devices apart later. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [device, browser].filter(Boolean).join(' · ');
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
