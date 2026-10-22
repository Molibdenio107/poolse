/**
 * The address the week stepper writes — POOLSE-108.
 *
 * The same page with only `week` changed. Every other parameter — `tab`,
 * `from` (POOLSE-91), a `section` — is kept, because they say what the reader
 * is looking at and where they came from: rebuilding the address from the path
 * dropped `?tab=week`, so a reload or any re-render that read the URL landed
 * on *Geral*, and Voltar forgot the screen it was opened from.
 */
export function withWeek(href: string, week: string): string {
  const url = new URL(href, 'http://poolse.invalid');
  url.searchParams.set('week', week);
  return `${url.pathname}${url.search}${url.hash}`;
}
