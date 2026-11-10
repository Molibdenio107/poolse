import { redirect } from 'next/navigation';

/**
 * The old *Fez 18 anos* list — POOLSE-207, folded away by POOLSE-213 (Rui,
 * 10-11-2026). Each student's own *Fez 18 anos* sits on their *Geral* now, and
 * who is waiting is *Alunos › Por rever* (turning 18 is one of its reasons) and
 * the bell. An old link or bookmark lands there.
 */
export default function TurnedOfAgeMoved(): never {
  redirect('/dashboard/students?review=1');
}
