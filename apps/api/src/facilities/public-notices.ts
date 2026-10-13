/**
 * What every public page says about where a complaint goes — POOLSE-73.
 *
 * A private operator (club, association, IPSS, hotel) must show access to the
 * Livro de Reclamações Eletrónico "em local visível e de forma destacada"
 * (DL 156/2005 art. 5.º-B n.º 2). The link is the official platform's, here
 * once; the DGC's icon manual points at `/inicio`. A public service (a pool run
 * directly by a câmara or freguesia) is under DL 135/99 instead and gives the
 * address of its own platform, which the schema requires.
 *
 * Source record: docs/research/public-notices-2026-10.md.
 */
export const LIVRO_RECLAMACOES_URL = 'https://www.livroreclamacoes.pt/inicio';

export type ComplaintsRegime = 'private' | 'public_service';

export interface PublicComplaints {
  regime: ComplaintsRegime;
  url: string;
}

export function complaintsFor(regime: string | null, url: string | null): PublicComplaints {
  if (regime === 'public_service' && url !== null && url !== '') {
    return { regime: 'public_service', url };
  }
  return { regime: 'private', url: LIVRO_RECLAMACOES_URL };
}

export interface PublicRegulation {
  /** `YYYY-MM-DD`: the day this version took effect. */
  effectiveFrom: string;
  body: string;
}

export function regulationFrom(raw: { effectiveFrom: string; body: string } | null | undefined): PublicRegulation | null {
  if (raw === null || raw === undefined) return null;
  return { effectiveFrom: String(raw.effectiveFrom).slice(0, 10), body: raw.body };
}
