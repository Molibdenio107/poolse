import type { Email } from './notifier.js';

/**
 * "Your child moved to the next level" — to the family, after the commit —
 * POOLSE-112 BA 4.
 *
 * Rendered from the notice's row, so the request and the hourly retry send one
 * email. The level names are the snapshot the row holds: a level renamed next
 * season must not rewrite what the family was told. The reason is said in words
 * — *idade* or *competências* — because "passou de nível" on its own invites a
 * phone call asking why.
 */
export interface LevelChangeEmailInput {
  to: string;
  organizationName: string;
  studentName: string;
  fromLevel: string;
  toLevel: string;
  reason: 'skills' | 'age';
  locale: string;
}

const COPY = {
  'pt-PT': {
    subject: (club: string, student: string) => `${club} — ${student} passou de nível`,
    body: (student: string, from: string, to: string) =>
      `${student} passou do nível ${from} para o nível ${to}.`,
    reason: {
      age: 'Motivo: a idade já ultrapassa a faixa etária do nível anterior, com a mudança de época.',
      skills: 'Motivo: concluiu todas as competências do nível anterior.',
    },
    next: 'O clube indica em breve a turma e o horário. Em caso de dúvida, fale com a secretaria.',
    why: 'Recebe este email por ser o contacto de família registado no clube.',
  },
  en: {
    subject: (club: string, student: string) => `${club} — ${student} moved up a level`,
    body: (student: string, from: string, to: string) =>
      `${student} moved from ${from} to ${to}.`,
    reason: {
      age: "Reason: with the new season, their age is past the previous level's age band.",
      skills: 'Reason: every skill of the previous level is complete.',
    },
    next: 'The club will confirm the class and timetable shortly. For any question, contact the office.',
    why: "You receive this email as the family contact registered with the club.",
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function levelChangeEmail(input: LevelChangeEmailInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const lines = [
    copy.body(input.studentName, input.fromLevel, input.toLevel),
    copy.reason[input.reason],
    '',
    copy.next,
    '',
    copy.why,
  ];
  return {
    to: input.to,
    subject: copy.subject(input.organizationName, input.studentName),
    text: lines.join('\n'),
    html: lines
      .filter((line) => line !== '')
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('\n'),
  };
}
