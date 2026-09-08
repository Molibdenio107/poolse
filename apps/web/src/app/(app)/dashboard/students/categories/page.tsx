import { getTranslations } from 'next-intl/server';
import { PageError, PageShell } from '@/components/page-shell';
import { CategoryList } from './category-list';
import { listCategories } from './categories.actions';

/**
 * The club's fee categories — POOLSE-23 AC4.
 *
 * Its own page rather than a panel on a facility, because a category is the
 * club's policy and not one site's: a "Sénior" that meant one thing at one pool
 * and another at the next is a category nobody could report on.
 *
 * Beside Níveis in the sidebar for the same reason Níveis is where it is — both
 * are lists a club sets up once and then rarely touches, and putting either on a
 * daily screen would give the daily job a settings panel it does not need.
 */
export default async function CategoriesPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = await listCategories();

  return (
    <PageShell title={t('categories.title')} subtitle={t('categories.hint')}>
      {data === null ? (
        /*
         * The endpoint refused, which for this page means one thing: somebody
         * who may not see the club's lists. Said rather than shown as an empty
         * list, because "there are no categories" and "this is not yours to
         * read" are different facts and only one of them is actionable.
         */
        <PageError message={t('categories.notPermitted')} />
      ) : (
        <div className="flex flex-col gap-6">
          <CategoryList categories={data.categories} canManage={data.canManage} />

          {/*
            What a category is *for*, said on the page rather than assumed.

            An operator arriving here has a list of names and no amounts, and the
            obvious question is where the money is. The answer — the turma or the
            enrolment, and the enrolment wins — is the whole model, and it is two
            sentences.
          */}
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('categories.howTitle')}
            </h2>
            <p className="mt-2 text-sm text-foreground-muted">{t('categories.howBody')}</p>
          </section>
        </div>
      )}
    </PageShell>
  );
}
