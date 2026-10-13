import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeLabResult, ORGANISMS } from './lab.js';

/**
 * Grading a lab result — POOLSE-72, NP 4542 §4.4. The ticket's QA 6–8.
 */

const COVERED = { kind: 'indoor', use: null } as const;
const CLEAN = {
  colonies_37c: 12,
  total_coliforms: 0,
  e_coli: 0,
  enterococci: 0,
  pseudomonas_aeruginosa: 0,
  staphylococcus_coagulase_positive: 0,
  staphylococcus_total: 3,
};

test('every limit and recommended value met is conforme', () => {
  const grading = gradeLabResult(
    {
      organisms: CLEAN,
      chemistry: [
        { metric: 'ph', value: 7.3, unit: 'pH' },
        { metric: 'free_chlorine', value: 1.0, unit: 'ppm' },
      ],
    },
    COVERED,
  );
  assert.equal(grading.grade, 'conforme');
  assert.deepEqual(grading.failures, []);
  assert.deepEqual(grading.organismsMissing, []);
});

test('QA 6: E. coli above 0 is não conforme, naming the organism and its limit', () => {
  const grading = gradeLabResult({ organisms: { ...CLEAN, e_coli: 1 }, chemistry: [] }, COVERED);
  assert.equal(grading.grade, 'nao_conforme');
  assert.deepEqual(grading.failures, [
    { parameter: 'e_coli', value: 1, unit: 'ufc/100 mL', limit: 0, kind: 'limit', direction: 'high' },
  ]);
});

test('QA 7: coliforms over the recommended 0 but under the limit is conforme condicionada', () => {
  const grading = gradeLabResult({ organisms: { ...CLEAN, total_coliforms: 5 }, chemistry: [] }, COVERED);
  assert.equal(grading.grade, 'conforme_condicionada');
  assert.equal(grading.failures[0]?.kind, 'recommended');
  assert.equal(grading.failures[0]?.limit, 0);

  // Past the limit of 10 it is a limit failure.
  const worse = gradeLabResult({ organisms: { ...CLEAN, total_coliforms: 11 }, chemistry: [] }, COVERED);
  assert.equal(worse.grade, 'nao_conforme');
});

test('QA 8: a report with chemistry only is graded on chemistry and says microbiology was absent', () => {
  const grading = gradeLabResult(
    { organisms: {}, chemistry: [{ metric: 'turbidity', value: 2.0, unit: 'NTU' }] },
    COVERED,
  );
  assert.equal(grading.microbiologyReported, false);
  assert.deepEqual(grading.organismsMissing, [...ORGANISMS]);
  // Turbidity is a Quadro 1 criterion: condicionada, not não conforme.
  assert.equal(grading.grade, 'conforme_condicionada');
  assert.equal(grading.failures[0]?.kind, 'criterion');
});

test('a disinfection limit (Quadro 2) fails as não conforme, chlorine judged by the same pH', () => {
  const grading = gradeLabResult(
    {
      organisms: CLEAN,
      chemistry: [
        { metric: 'ph', value: 7.2, unit: 'pH' },
        { metric: 'free_chlorine', value: 1.5, unit: 'ppm' },
      ],
    },
    COVERED,
  );
  assert.equal(grading.grade, 'nao_conforme');
  assert.equal(grading.failures[0]?.parameter, 'free_chlorine');
  assert.equal(grading.failures[0]?.ph, 7.2);
});

test('an unreported parameter is not judged, and nothing reported is no grade at all', () => {
  const partial = gradeLabResult({ organisms: { e_coli: 0 }, chemistry: [] }, COVERED);
  assert.equal(partial.grade, 'conforme');
  assert.equal(partial.organismsMissing.length, ORGANISMS.length - 1);

  const nothing = gradeLabResult(
    { organisms: {}, chemistry: [{ metric: 'salt', value: 4000, unit: 'ppm' }] },
    COVERED,
  );
  assert.equal(nothing.grade, null, 'never a silent conforme');
});
