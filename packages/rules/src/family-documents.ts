/**
 * Which papers concern a child — POOLSE-179. The FPN is the swimming federation,
 * so its declaration is swimming's; the rest are the club's, in every sport. A
 * second federation's form is another entry here and another `student_document`
 * kind.
 */
export const FAMILY_DOCUMENTS = ['fpn_declaration', 'socio_form', 'id_document', 'medical_exam'] as const;
export type FamilyDocument = (typeof FAMILY_DOCUMENTS)[number];

/** The sports a document is limited to. Absent is every sport. */
export const DOCUMENT_SPORTS: Partial<Record<FamilyDocument, readonly string[]>> = {
  fpn_declaration: ['pool'],
};

/** The documents for somebody in these sports: never the club's whole list. */
export function documentsForSports(sports: readonly string[]): FamilyDocument[] {
  return FAMILY_DOCUMENTS.filter((kind) => {
    const limited = DOCUMENT_SPORTS[kind];
    return limited === undefined || limited.some((sport) => sports.includes(sport));
  });
}
