import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { LinkBusy } from '@/components/link-busy';

/**
 * The way back from a filled form — POOLSE-179. An installed app has no browser
 * bar, and the form's page is the office's own, so *Voltar* is added around it
 * and left off the paper.
 */
export default async function FamilyFormLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  return (
    <>
      <Link
        href={`/app/familia/documentos?child=${id}`}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 print:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('app.documents.backTo')}
        <LinkBusy />
      </Link>
      {children}
    </>
  );
}
