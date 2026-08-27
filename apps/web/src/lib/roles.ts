/**
 * The roles a member can hold, and the order they read in — POOLSE-18.
 *
 * Kept apart from `role-badge.tsx` so it can be tested without React: the
 * ordering is the only real logic in that file, and a component full of JSX is
 * not importable by the plain `node --test` runner the rest of the library uses.
 *
 * This list mirrors `member_role` in the schema and `MEMBER_ROLES` in the API.
 * Three copies is one more than anybody wants, but the alternative — a shared
 * package for six strings — costs more to maintain than it saves, and both other
 * copies fail loudly if this one drifts: the API validates against the enum, and
 * the database refuses a value it does not know.
 */
export const MEMBER_ROLES = [
  'owner',
  'admin',
  'instructor',
  'maintenance',
  'guardian',
  'student',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Owner → Admin → Instructor → Maintenance → Encarregado → Student.
 *
 * The order POOLSE-18 asks for, and the one that makes a multi-role person
 * readable: the badge that says most about what somebody can do comes first. A
 * senior student who is also an encarregado de educação reads as
 * "Encarregado · Aluno", which is how their club would describe them.
 */
const SENIORITY: Record<string, number> = Object.fromEntries(
  MEMBER_ROLES.map((role, index) => [role, index]),
);

/**
 * Sorts roles by seniority.
 *
 * A role this file has not heard of sorts last rather than first. If the schema
 * gains one before this list does, the badge still renders and still sorts
 * predictably — it just sits at the end, which is the harmless answer. Sorting
 * an unknown role to the front would put it above Owner.
 */
export function bySeniority(roles: readonly string[]): string[] {
  return [...roles].sort(
    (a, b) => (SENIORITY[a] ?? MEMBER_ROLES.length) - (SENIORITY[b] ?? MEMBER_ROLES.length),
  );
}
