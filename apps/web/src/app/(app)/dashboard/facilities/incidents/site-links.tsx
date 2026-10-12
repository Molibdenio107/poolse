import Link from 'next/link';

/**
 * The site row Receção draws, for the incident list and its form.
 *
 * Nothing at all for a club with one site — a single pill is a choice with one
 * answer. `aria-current` and the fill mark the chosen one, never colour alone.
 */
export function SiteLinks({
  sites,
  chosenId,
  basePath,
  label,
}: {
  sites: { id: string; name: string }[];
  chosenId: string;
  basePath: string;
  label: string;
}): React.ReactElement | null {
  if (sites.length < 2) return null;

  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {sites.map((site) => (
        <Link
          key={site.id}
          href={`${basePath}?site=${site.id}`}
          aria-current={site.id === chosenId ? 'page' : undefined}
          className={
            site.id === chosenId
              ? 'inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground'
              : 'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted'
          }
        >
          {site.name}
        </Link>
      ))}
    </nav>
  );
}
