import { getTranslations } from 'next-intl/server';

/**
 * Water quality — the shape of it, before the data exists.
 *
 * pH, temperature and the analysis report are phase 4 (`docs/roadmap.md`), and
 * they need decisions this round is not making: readings are time-series, which
 * is what TimescaleDB is in the stack for, and each has its own unit — CLAUDE.md
 * is explicit that pH, °C, ppm and kWh do not share a type. Building the table
 * now, to hold nothing, would be guessing at all of that a month early.
 *
 * So this is the same treatment the photo and logo controls get: present, laid
 * out, and visibly inert. That is a deliberate choice rather than a stub. An
 * operator who opens a pool and finds no mention of pH concludes Poolse does not
 * do water quality; one who finds an empty panel that says "not yet" knows it is
 * coming and stops looking for it elsewhere.
 *
 * **It is built to take a reading row, not to be decoration.** The eventual
 * shape is known — a labelled measurement with a value, a unit and when it was
 * taken — and the import the owner described (upload an analysis report, read
 * the values out of it, show the ones that need controlling) is what the second
 * control is a placeholder for. Whoever fills this in replaces the empty state
 * with rows; they do not start from a blank file.
 *
 * A server component. Nothing here is interactive yet, and a `'use client'` on a
 * panel of disabled buttons would ship a bundle for nothing.
 */
export async function ReadingsBlock({
  canManage,
}: {
  canManage: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  const measurements = [
    { key: 'ph', label: t('facilities.readingPh') },
    { key: 'temperature', label: t('facilities.readingTemperature') },
    { key: 'analysis', label: t('facilities.readingAnalysis') },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">{t('facilities.readingsHint')}</p>

      {/*
        Three tiles with no value in them, rather than a sentence saying there is
        nothing. The empty state is the layout the real one will use, so the
        change that fills it in is a change of content and not of design — and an
        operator can already see which three things Poolse intends to track.
      */}
      <dl className="grid gap-3 sm:grid-cols-3">
        {measurements.map((measurement) => (
          <div
            key={measurement.key}
            className="flex flex-col gap-0.5 rounded border border-dashed border-border p-3"
          >
            <dt className="text-sm text-foreground-muted">{measurement.label}</dt>
            {/*
              An em dash, not a zero. A pH of 0 is a reading; no reading is not.
            */}
            <dd className="text-2xl font-semibold text-foreground-muted">—</dd>
          </div>
        ))}
      </dl>

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled
            title={t('facilities.readingsSoon')}
            className="cursor-not-allowed rounded border border-border px-3 py-1.5 text-sm text-foreground-muted opacity-60"
          >
            {t('facilities.readingAdd')}
          </button>
          <button
            type="button"
            disabled
            title={t('facilities.readingsSoon')}
            className="cursor-not-allowed rounded border border-border px-3 py-1.5 text-sm text-foreground-muted opacity-60"
          >
            {t('facilities.readingImport')}
          </button>
          <span className="text-sm text-foreground-muted">{t('facilities.readingsSoon')}</span>
        </div>
      )}
    </div>
  );
}
