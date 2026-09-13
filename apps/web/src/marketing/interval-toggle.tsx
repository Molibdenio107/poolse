'use client';

import { useState } from 'react';

/**
 * Mensal or Anual, on the public pricing page — POOLSE-60.
 *
 * **The only client component on the marketing site**, and deliberately the
 * smallest one that could work: it holds a single choice and renders a
 * placeholder. Everything around it stays a server render.
 *
 * **Its strings are passed in.** The marketing pages have their own translator
 * (`translator(locale)`) rather than next-intl's provider, because they render
 * for a locale chosen by the route rather than by a session — so a client
 * component underneath them cannot call `useTranslations`. Handing the words
 * down keeps that boundary intact and keeps this file free of any of its own.
 *
 * **Yearly is selected first.** It is what the club is being nudged towards, and
 * a default that has to be found is not a default.
 */

type Interval = 'yearly' | 'monthly';

export function IntervalToggle({
  labels,
}: {
  labels: {
    yearly: string;
    monthly: string;
    perYear: string;
    perMonth: string;
    placeholder: string;
    note: string;
    yearlyHint: string;
  };
}): React.ReactElement {
  const [interval, setInterval] = useState<Interval>('yearly');

  return (
    <div className="flex flex-col gap-3">
      {/*
        A radio group rather than two buttons: this is one choice with two
        answers, which is what a radio group *is*, and it gets arrow-key
        navigation and a screen-reader announcement for free.
      */}
      <div role="radiogroup" aria-label={labels.yearly} className="flex gap-2">
        {(['yearly', 'monthly'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={interval === option}
            onClick={() => setInterval(option)}
            className={`rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              interval === option
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border text-foreground-muted hover:border-primary/50'
            }`}
          >
            {option === 'yearly' ? labels.yearly : labels.monthly}
          </button>
        ))}
      </div>

      {/*
        The placeholder is meant to look unfinished. A grey dash reads as "not
        decided yet"; an invented number reads as a commitment.
      */}
      <div className="flex flex-col gap-1">
        <span className="rounded border border-dashed border-border px-3 py-3 text-center text-2xl font-semibold text-foreground-muted">
          {labels.placeholder}{' '}
          <span className="text-base font-normal">
            {interval === 'yearly' ? labels.perYear : labels.perMonth}
          </span>
        </span>
        <span className="text-xs text-foreground-muted">
          {interval === 'yearly' ? labels.yearlyHint : labels.note}
        </span>
      </div>
    </div>
  );
}
