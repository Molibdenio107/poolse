import { getTranslations } from 'next-intl/server';
import { apiFetch, apiFileResponse, ApiError } from '@/lib/api';
import { today } from '@/lib/dates';
import { formPdf } from '@/lib/form-pdf';
import { boletimFormValues, type BoletimPrint } from '@/lib/form-values';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The club's boletim de sócio as a file — POOLSE-193. The API decides who may
 * read it, leaves the SNS number off for a family, and audits the read, on the same
 * route the print page uses.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });

  let data: BoletimPrint;
  try {
    data = await apiFetch<BoletimPrint>(`/students/${id}/boletim`);
  } catch (error) {
    return new Response(null, { status: error instanceof ApiError && error.status === 403 ? 403 : 404 });
  }
  const template = data.template;
  if (template === null || template.fields.length === 0) return new Response(null, { status: 404 });

  const upstream = await apiFileResponse(`/files/${template.fileId}`);
  if (!upstream.ok) return new Response(null, { status: 404 });

  const pt = await getTranslations({ locale: 'pt-PT' });
  const bytes = await formPdf({
    image: new Uint8Array(await upstream.arrayBuffer()),
    contentType: upstream.headers.get('content-type') ?? 'image/jpeg',
    placements: template.fields,
    values: boletimFormValues(data, pt),
    today: today(),
    title: pt('boletimTemplate.kind.socio_form'),
  });
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="boletim-de-socio.pdf"',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
