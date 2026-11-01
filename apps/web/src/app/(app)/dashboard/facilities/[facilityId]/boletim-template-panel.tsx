import { getTranslations } from 'next-intl/server';
import type { TemplateKind } from '@poolse/rules';
import { FromLink } from '@/components/from-link';
import { PageError } from '@/components/page-shell';
import { SectionPills, SUB_MENU_ROW, pickSection, sectionHref, subMenuPillClass } from '@/components/section-pills';
import { storageConfigured } from '@/lib/storage-status';
import { readBoletimTemplate } from './boletim-template.actions';
import { BoletimTemplateEditor } from './boletim-template-editor';

/**
 * The site page's *Documentos* tab — POOLSE-142 (Rui, 01-11-2026): the club's
 * own paper forms, each filled for every student when printed from the
 * student's record. Two sections, one at a time: the boletim de sócio and the
 * FPN declaration, and inside the FPN one, its two versions (adults, and minors
 * signed by the guardian), because the federation prints two different forms.
 * The forms are the club's, not the site's, which the hint says.
 */
const SECTIONS = ['boletim', 'fpn'] as const;
const FPN_FORMS = { adult: 'fpn_declaration', minor: 'fpn_declaration_minor' } as const;

export async function DocumentsTab({
  path,
  from,
  section,
  form,
}: {
  path: string;
  from: string | undefined;
  section: string | undefined;
  form: string | undefined;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const current = pickSection(SECTIONS, section, 'boletim');
  const which = form === 'minor' ? 'minor' : 'adult';
  const kind: TemplateKind = current === 'boletim' ? 'socio_form' : FPN_FORMS[which];

  return (
    <div className="flex flex-col gap-4">
      <SectionPills
        label={t('boletimTemplate.sectionNav')}
        current={current}
        items={SECTIONS.map((key) => ({
          key,
          label: t(`boletimTemplate.section.${key}`),
          href: sectionHref(path, { tab: 'documents', from }, key),
        }))}
      />
      {current === 'fpn' && (
        <nav aria-label={t('boletimTemplate.fpnFormNav')} className={SUB_MENU_ROW}>
          {(['adult', 'minor'] as const).map((option) => (
            <FromLink
              key={option}
              href={`${sectionHref(path, { tab: 'documents', from }, 'fpn')}&form=${option}`}
              aria-current={option === which ? 'page' : undefined}
              scroll={false}
              className={subMenuPillClass(option === which)}
            >
              {t(`boletimTemplate.fpnForm.${option}`)}
            </FromLink>
          ))}
        </nav>
      )}
      <BoletimTemplatePanel kind={kind} />
    </div>
  );
}

/** One of the club's forms. A refusal hides the card; a failure says so in its place. */
async function BoletimTemplatePanel({ kind }: { kind: TemplateKind }): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const [loaded, ready] = await Promise.all([readBoletimTemplate(kind), storageConfigured()]);
  if (loaded.state === 'refused') return <PageError message={t('common.notAllowed')} />;

  return (
    <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t(`boletimTemplate.kind.${kind}`)}
        </h2>
        <p className="mt-2 text-sm text-foreground-muted">
          {t(kind === 'socio_form' ? 'boletimTemplate.hint' : 'boletimTemplate.hintFpn')}
        </p>
      </div>
      {loaded.state === 'failed' ? (
        <PageError message={t(loaded.failure.key)} />
      ) : (
        <BoletimTemplateEditor key={kind} kind={kind} template={loaded.data.template} storageReady={ready} />
      )}
    </section>
  );
}
