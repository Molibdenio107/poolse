/**
 * The FPN's *Anexo 2 — Declaração de Consentimento Informado*, and what the
 * student's *Documentos* tab reads and prints — POOLSE-132 (Rui, 30-10-2026).
 *
 * **The form's text is plain Portuguese here, not message keys.** It is an
 * official document reproduced word for word, and it prints in Portuguese
 * whatever the reader's language — so it is not interface text, and putting it
 * in the catalogue would invite somebody to "translate" a legal declaration.
 * The interface around it (buttons, headings on screen) stays in the catalogue.
 *
 * **Per season.** `FPN_FORMS` is keyed by the season's start year; a season with
 * no text of its own prints the latest with its season substituted (the
 * ticket's default until the FPN publishes 2027-2028's wording). A new text is
 * one entry here.
 *
 * Template tokens: `{name}` is a blank filled from the record (an underscore
 * line when the record lacks it); `**…**` is bold, as on the FPN's form.
 */

export const FPN_DISCIPLINES = ['pura', 'open_water', 'water_polo', 'artistic', 'adapted', 'masters', 'diving'] as const;
export type FpnDiscipline = (typeof FPN_DISCIPLINES)[number];
export type StudentIdDocumentType = 'cc' | 'bi' | 'passport' | 'other';
export type StudentDocumentKind = 'fpn_declaration' | 'fpn_declaration_minor' | 'socio_form';

/** `GET /students/:id/documents`. */
export interface StudentDocuments {
  studentName: string;
  minor: boolean | null;
  disciplines: FpnDiscipline[];
  idDocument: {
    type: StudentIdDocumentType | null;
    hasNumber: boolean;
    issuedOn: string | null;
    validUntil: string | null;
  };
  club: { association: string | null; clubCode: string | null };
  seasons: { id: string; name: string; published: boolean }[];
  copies: {
    id: string;
    kind: StudentDocumentKind;
    seasonId: string | null;
    fileId: string;
    filedAt: string;
    filedByName: string | null;
    replacedAt: string | null;
  }[];
  /** What the Anexo 2 would print blank. */
  missing: string[];
}

/** `GET /students/:id/documents/fpn`. The ID number is decrypted, and the read audited. */
export interface FpnPrint {
  signerName: string;
  studentName: string;
  minor: boolean;
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  idDocumentType: StudentIdDocumentType | null;
  idDocumentNumber: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  seasonName: string | null;
  disciplines: FpnDiscipline[];
  association: string | null;
  clubCode: string | null;
  place: string | null;
}

export interface FpnFormText {
  annex: string;
  title: string;
  /** Tokens: signer, guardianOf, address, locality, postalCode, number, issuedOn, validUntil, season. */
  identity: string;
  privacy: string;
  image: string;
  tickLabel: string;
  /** The boxes, in the form's order, with the form's own abbreviations. */
  boxes: Record<FpnDiscipline, string>;
  association: string;
  club: string;
  individual: string;
  placeDate: string;
  signature: string;
  note: string;
  closing: string;
  /** For the minors' form: said after the signer's name. Token: student. */
  guardianOf: string;
}

const ANEXO_2_2026: FpnFormText = {
  annex: 'ANEXO 2',
  title: 'DECLARAÇÃO DE CONSENTIMENTO INFORMADO',
  identity:
    'Eu, abaixo assinado(a) {signer}{guardianOf} residente em {address} (localidade) {locality} (código-postal) {postalCode} portador(a) do Documento de Identificação ( Bilhete de Identidade, Cartão de Cidadão, Passaporte ou outros) nº {number} emitido em {issuedOn} válido até {validUntil}, para efeitos de processo de filiações época {season} e na qualidade de agente desportivo, autorizo o tratamento pela FPN dos meus dados pessoais de nomes, números de identificação fiscal, número de cartão de cidadão/bilhete de identidade ou passaporte, morada, telefone e endereço de correio eletrónico, indicados na ficha de inscrição eletrónica na plataforma "FPNSystem" para a época desportiva {season}, para efeitos de envio de comunicações, por meios eletrónicos, telefónicos e ou postais, e divulgação de informações, eventos e ações da FPN., na medida do estritamente necessário à prossecução das finalidades decorrentes da respetiva inscrição, designadamente a obrigação legal de identificação do agente desportivo e de processamento automático dos seus dados pessoais, podendo os mesmos ser disponibilizados a terceiros, nomeadamente, para publicação de Circulares, Comunicados e ou Ofícios da FPN, desde que tal disponibilização decorra da lei, dos estatutos e ou dos regulamentos federativos e não viole disposições imperativas em matéria de proteção de dados.',
  privacy:
    '**Declaro aceitar** a Política de Privacidade da FPN, disponível para consulta em https://fpnatacao.pt/politicaprivacidade.php, da qual, nesta data, tomei conhecimento, bem como **declaro tomar conhecimento** que os meus dados pessoais serão guardados pelo período de tempo fixado na referida “Política de Privacidade" ou durante o tempo estritamente necessário às finalidades para que foram recolhidos, e, bem assim, **declaro tomar conhecimento** que, nos termos da legislação aplicável, é-me garantido, a todo o tempo, o exercício dos direitos de acesso, retificação, atualização e eliminação (apagamento) dos dados pessoais, podendo opor-me ao tratamento dos mesmos mediante pedido escrito dirigido ao responsável pelo tratamento de dados da FPN, e que me assiste o direito de apresentar queixa junto Comissão Nacional de Proteção de Dados através do Website www.cnpd.pt.',
  image:
    'Por último, **consinto** na recolha, edição, utilização e difusão da minha imagem e voz, através de fotografias, imagens e som obtidos em eventos desportivos e festivos da FPN e a sua publicação, reprodução e transmissão pela FPN nos seus Websites, Redes Sociais e demais plataformas digitais.',
  tickLabel: 'Assinalar em conformidade:',
  boxes: {
    pura: 'N. Pura',
    open_water: 'Águas Abertas',
    water_polo: 'Polo-Aquático',
    artistic: 'N. Artística',
    adapted: 'N. Adaptada',
    masters: 'Masters',
    diving: 'Saltos',
  },
  association: 'Associação',
  club: 'Clube',
  individual: 'Individual',
  placeDate: 'Local/Data:',
  signature: 'Assinatura (igual ao doc. de identificação):',
  note:
    'Nota: Mediante prévio consentimento do titular, anexar fotocópia do Bilhete de Identidade ou do Cartão de Cidadão ou de outro documento de identificação civil do(a) subscritor(a) da autorização, ou assinatura reconhecida por qualquer entidade legalmente autorizada para o efeito ou conferência da identidade do(s) interessado(s) através da comparação com a imagem facial constante do documento de identificação apresentado para o efeito.',
  closing: 'O não fornecimento dos elementos de identificação inviabiliza a inscrição na FPN.',
  // Rui's default until the FPN's *Menores* form is supplied (ticket, Open).
  guardianOf: ' na qualidade de encarregado de educação de {student}',
};

/** By the season's first year. The latest applies to any later season. */
const FPN_FORMS: readonly (readonly [number, FpnFormText])[] = [[2026, ANEXO_2_2026]];

/** The form's text for a season name — the latest one at or before its year. */
export function fpnFormFor(seasonName: string | null): FpnFormText {
  const year = seasonYears(seasonName)?.start ?? null;
  const ordered = [...FPN_FORMS].sort((a, b) => b[0] - a[0]);
  const fit = year === null ? undefined : ordered.find(([from]) => from <= year);
  return (fit ?? ordered[0]!)[1];
}

function seasonYears(name: string | null): { start: number; end: number } | null {
  if (name === null) return null;
  const match = /(\d{4})\s*[/\-–]\s*(\d{2}|\d{4})(?!\d)/.exec(name);
  if (match === null) return null;
  const start = Number(match[1]);
  const end = match[2]!.length === 2 ? Math.floor(start / 100) * 100 + Number(match[2]) : Number(match[2]);
  return { start, end };
}

/**
 * The season as the FPN writes it: "2026-2027". A name with a year range in it
 * ("2026/27", "Época 2026-27") becomes that; anything else prints as the club
 * named it.
 */
export function fpnSeasonLabel(name: string | null): string | null {
  if (name === null) return null;
  const years = seasonYears(name);
  return years === null ? name : `${years.start}-${years.end}`;
}

export type FormPiece =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'token'; name: string };

/** A template as pieces: plain text, bold text, and `{token}`s for the page to fill. */
export function formPieces(template: string): FormPiece[] {
  return template
    .split(/(\{[a-zA-Z]+\}|\*\*[^*]+\*\*)/)
    .filter((part) => part !== '')
    .map((part): FormPiece => {
      if (part.startsWith('{') && part.endsWith('}')) return { kind: 'token', name: part.slice(1, -1) };
      if (part.startsWith('**') && part.endsWith('**')) return { kind: 'bold', text: part.slice(2, -2) };
      return { kind: 'text', text: part };
    });
}
