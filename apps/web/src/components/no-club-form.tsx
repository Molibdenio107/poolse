import { useTranslations } from 'next-intl';
import { FromLink } from '@/components/from-link';

/**
 * In place of *Imprimir* when the club has not set up this form — Rui,
 * 01-11-2026: the boletim and the FPN declaration print only from the club's
 * own form (Instalações → Documentos), never from a page Poolse composes. Says
 * which form is missing and where to set it; the link opens that section.
 */
export function NoClubForm({
  kind,
  siteId,
}: {
  kind: 'socio_form' | 'fpn_declaration' | 'fpn_declaration_minor';
  siteId: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const section = kind === 'socio_form' ? 'boletim' : 'fpn';
  const form = kind === 'fpn_declaration_minor' ? '&form=minor' : '';
  return (
    <p className="text-sm">
      {t('boletimTemplate.notConfigured', { form: t(`boletimTemplate.kind.${kind}`) })}{' '}
      {siteId !== null && (
        <FromLink
          href={`/dashboard/facilities/${siteId}?tab=documents&section=${section}${form}`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {t('boletimTemplate.notConfiguredLink')}
        </FromLink>
      )}
    </p>
  );
}
