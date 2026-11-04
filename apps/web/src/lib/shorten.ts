/**
 * A long text cut at the end — "Hidroginá…" — with the whole of it left to a
 * tooltip (Rui, 04-11-2026, the Alunos table). Counts characters, not pixels:
 * a fixed length keeps the rows from jumping as the window resizes.
 *
 * Returns the text unchanged when it fits.
 */
export function shorten(text: string, max: number): string {
  const chars = Array.from(text);
  if (max < 2 || chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}
