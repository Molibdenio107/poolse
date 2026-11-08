/**
 * *Grau de parentesco* — what the person filling a form is to the child (Rui,
 * 07-11-2026): a short list rather than free text. The value saved is the club's
 * own word in Portuguese, as `guardian_link.relationship` has always held ("Mãe",
 * "Tia"), so every screen that reads the column reads it unchanged; the label is
 * the reader's language. The office's own student form keeps free text.
 */
export const KINSHIP = [
  { value: 'Mãe', key: 'mother' },
  { value: 'Pai', key: 'father' },
  { value: 'Avó', key: 'grandmother' },
  { value: 'Avô', key: 'grandfather' },
  { value: 'Tutor legal', key: 'legalGuardian' },
  { value: 'Outro', key: 'other' },
] as const;

export type KinshipKey = (typeof KINSHIP)[number]['key'];
