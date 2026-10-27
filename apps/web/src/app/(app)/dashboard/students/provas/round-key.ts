/** LENEX rounds Poolse names (`meets.round.*`); any other code reads as "other". */
export function roundKey(round: string): string {
  return ['PRE', 'SEM', 'FIN', 'SOP', 'SOS', 'QUA'].includes(round) ? round.toLowerCase() : 'other';
}
