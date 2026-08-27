import { ScrollX } from '@/components/page-shell';
import { cn } from '@/lib/utils';

/**
 * The table primitive — POOLSE-40.
 *
 * One of these rather than a second hand-rolled table, because inconsistency is
 * the actual complaint: the skills list read as stacked paragraphs while every
 * other dense view in the app was aligned, and adding a bespoke table here would
 * have made three shapes instead of one.
 *
 * **It owns its own horizontal scroll.** A narrow viewport scrolls the table,
 * never the page — the standing rule from POOLSE-41 AC5, and this is where it
 * bites first.
 *
 * **Numeric columns are right-aligned with tabular figures**, so values compare
 * down the column. Proportional digits make 7 and 11 the same width and a column
 * of them impossible to scan.
 */

export interface Column<T> {
  key: string;
  /** Already translated. */
  header: string;
  /** Right-aligned with tabular figures — for anything you compare down a column. */
  numeric?: boolean;
  /** Assistive-only header, for an actions column with no visible label. */
  hiddenHeader?: boolean;
  render: (row: T, index: number) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Shown instead of an empty table body — a blank grid explains nothing. */
  empty?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;

  return (
    <ScrollX className={className}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-3 py-2 font-medium text-foreground-muted',
                  column.numeric === true ? 'text-right' : 'text-left',
                )}
              >
                {/* Still announced, just not drawn — an actions column has no
                    sensible visible label but a screen reader needs one. */}
                <span className={column.hiddenHeader === true ? 'sr-only' : undefined}>
                  {column.header}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border last:border-0 hover:bg-surface-muted"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-3 py-2 align-middle',
                    column.numeric === true && 'text-right tabular-nums',
                  )}
                >
                  {column.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}
