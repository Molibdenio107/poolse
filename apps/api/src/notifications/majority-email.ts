import type { Email } from './notifier.js';

/**
 * "{nome} fez 18 anos" — POOLSE-208 rule 3. One to each parent with a live
 * parental link, one to the student, in the recipient's own locale. Rendered
 * from the `majority_notice` row, so the job and the hourly retry send one
 * email. The Portuguese is for Rui to read before go-live.
 */
export interface MajorityEmailInput {
  to: string;
  organizationName: string;
  studentName: string;
  kind: 'parent' | 'student';
  /** The parent was the payer, and stays it. */
  payer: boolean;
  locale: string;
}

const COPY = {
  'pt-PT': {
    subject: (club: string, student: string) => `${club} — ${student} fez 18 anos`,
    parent: {
      what: (student: string) =>
        `${student} fez 18 anos. Na app do clube, um encarregado de educação deixa de ver as aulas, os progressos e os documentos de um aluno maior de idade.`,
      payer: (student: string) =>
        `Continua a ser quem paga: em Pagamentos e Extratos vê as mensalidades e os documentos de ${student}.`,
      notPayer: 'Deixa de ver este aluno na app.',
      supported:
        'Se esta pessoa tem um acompanhamento decidido por tribunal (maior acompanhado), fale com a secretaria do clube.',
    },
    student: {
      what: 'Parabéns! Fez 18 anos e passa a tratar das suas coisas no clube por si.',
      consents:
        'Algumas autorizações (por exemplo, fotografias) foram dadas pelo seu encarregado. Entre na app e, em Perfil, confirme-as ou retire-as.',
      login: 'Se ainda não tem acesso à app, peça um convite à secretaria do clube.',
    },
    why: 'Recebe este email por ser contacto registado no clube.',
  },
  en: {
    subject: (club: string, student: string) => `${club} — ${student} turned 18`,
    parent: {
      what: (student: string) =>
        `${student} turned 18. In the club's app, a parent no longer sees an adult student's lessons, progress or documents.`,
      payer: (student: string) =>
        `You remain the payer: Payments and Statements still show ${student}'s fees and documents.`,
      notPayer: 'You no longer see this student in the app.',
      supported:
        'If this person has court-ordered support (a supported adult), please talk to the club office.',
    },
    student: {
      what: 'Happy birthday! You are 18 and now handle your own things at the club.',
      consents:
        'Some permissions (photos, for example) were given by your parent. Open the app and, under Profile, confirm or withdraw them.',
      login: 'If you do not have access to the app yet, ask the club office for an invitation.',
    },
    why: 'You receive this email as a contact registered with the club.',
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function majorityEmail(input: MajorityEmailInput): Email {
  const copy = input.locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const lines =
    input.kind === 'parent'
      ? [
          copy.parent.what(input.studentName),
          input.payer ? copy.parent.payer(input.studentName) : copy.parent.notPayer,
          '',
          copy.parent.supported,
        ]
      : [copy.student.what, copy.student.consents, '', copy.student.login];
  lines.push('', copy.why);
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
