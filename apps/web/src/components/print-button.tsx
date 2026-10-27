'use client';

/**
 * Opens the browser's print dialog, from which "Save as PDF" is one choice.
 *
 * A client component for one `onClick`, and nothing else — the report itself
 * stays a server component. Deliberately *not* an effect that prints on mount:
 * a dialog that opens before the page has painted is a dialog people dismiss
 * without reading, and printing should be something the operator asked for.
 */
export function PrintButton({ label }: { label: string }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-black/40 text-black"
    >
      {label}
    </button>
  );
}
