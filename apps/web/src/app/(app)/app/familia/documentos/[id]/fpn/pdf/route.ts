import { getTranslations } from 'next-intl/server';
import { apiFetch, apiFileResponse, ApiError } from '@/lib/api';
import { today } from '@/lib/dates';
import { formPdf } from '@/lib/form-pdf';
import { fpnFormValues } from '@/lib/form-values';
import { fpnSeasonLabel, type FpnPrint } from '@/lib/fpn-forms';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The FPN declaration as a file, to sign by hand or with Chave Móvel Digital —
 * POOLSE-193. The API decides who may read it and audits the read, on the same route
 * the print page uses.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });

  const asked = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const season = asked.get('season');
  if (season !== null && UUID.test(season)) query.set('season', season);
  if (asked.get('minor') === '1') query.set('minor', '1');

  let data: FpnPrint;
  try {
    data = await apiFetch<FpnPrint>(`/students/${id}/documents/fpn?${query.toString()}`);
  } catch (error) {
    return new Response(null, { status: error instanceof ApiError && error.status === 403 ? 403 : 404 });
  }
  const template = data.template ?? null;
  if (template === null || template.fields.length === 0) return new Response(null, { status: 404 });

  const upstream = await apiFileResponse(`/files/${template.fileId}`);
  if (!upstream.ok) return new Response(null, { status: 404 });

  const pt = await getTranslations({ locale: 'pt-PT' });
  const bytes = await formPdf({
    image: new Uint8Array(await upstream.arrayBuffer()),
    contentType: upstream.headers.get('content-type') ?? 'image/jpeg',
    placements: template.fields,
    values: fpnFormValues(data, fpnSeasonLabel(data.seasonName), pt),
    today: today(),
    title: pt(`boletimTemplate.kind.${data.minor ? 'fpn_declaration_minor' : 'fpn_declaration'}`),
  });
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="declaracao-fpn.pdf"',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
