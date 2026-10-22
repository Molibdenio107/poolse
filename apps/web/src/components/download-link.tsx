'use client';

import type { AnchorHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { trackBusy } from '@/lib/busy';

/**
 * A link to a file the app makes — an export, a certificate — that says, in the
 * corner, that the file is on its way. POOLSE-98.
 *
 * A plain `<a href>` to a route handler gives no signal: the browser shows
 * nothing until the file lands, and somebody clicks again. So an ordinary click
 * fetches the file under *A exportar…*, then hands it to the browser under the
 * name the server gave it (`Content-Disposition`). The `href` stays a real one:
 * a middle click, a modified click or no JavaScript at all still get the file
 * the old way.
 *
 * A refusal or a failure is a toast in words, rather than the browser
 * navigating to an error page and leaving the screen somebody was on.
 */
export function DownloadLink({
  href,
  onClick,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): React.ReactElement {
  const t = useTranslations();
  const toast = useToast();

  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        // A page in its own tab (a PDF's print view) is the browser's to show loading.
        if (props.target === '_blank') return;
        event.preventDefault();
        void trackBusy('export', async () => {
          try {
            const response = await fetch(href, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(String(response.status));
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download =
              fileName(response.headers.get('content-disposition')) ??
              (typeof props.download === 'string' ? props.download : lastSegment(href));
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            // Long enough for the browser to have taken the file.
            window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
          } catch {
            toast.show('danger', t('busy.exportFailed'));
          }
        });
      }}
    >
      {children}
    </a>
  );
}

/** The name in `Content-Disposition`, preferring the UTF-8 form. */
function fileName(header: string | null): string | null {
  if (header === null) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1] !== undefined) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

function lastSegment(href: string): string {
  return href.split('?')[0]?.split('/').filter(Boolean).at(-1) ?? 'download';
}
