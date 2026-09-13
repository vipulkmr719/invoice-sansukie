import { formatJapaneseMonth, formatShortMonth } from '@/lib/date';
import { formatYen } from '@/domain/money';

/**
 * Six-month billing trend.
 *
 * Drawn with plain elements rather than a charting library: it is one short
 * series, and an `sr-only` table carries the same numbers to screen readers
 * without shipping an extra bundle.
 *
 * Layout note: the columns must stretch to the full height of the row —
 * `align-items: flex-end` on the row would collapse each column to its label,
 * leaving the bar's percentage height resolving against zero.
 */
export function MonthlyChart({
  data,
}: {
  data: { month: string; total: number }[];
}) {
  const peak = Math.max(...data.map((point) => point.total), 0);
  const scale = peak > 0 ? peak : 1;

  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs text-ink-400">
        最大 <span className="tabular font-medium text-ink-600">{formatYen(peak)}</span>
      </p>

      <div className="flex h-44 gap-1.5 sm:gap-4" aria-hidden="true">
        {data.map((point) => {
          // Give any non-zero month a visible sliver so a small month still reads
          // as "some billing" rather than "none".
          const heightPercent =
            point.total === 0 ? 0 : Math.max((point.total / scale) * 100, 3);

          return (
            <div
              key={point.month}
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-2 overflow-hidden"
            >
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-md bg-brand-500/85"
                  style={{ height: `${heightPercent}%` }}
                  title={`${formatJapaneseMonth(point.month)} ${formatYen(point.total)}`}
                />
              </div>
              <span className="truncate text-[11px] text-ink-400">
                {/* Six full "2026年9月" labels do not fit a phone viewport and
                    would widen the whole grid track, so narrow screens get the
                    month alone. */}
                <span className="sm:hidden">{formatShortMonth(point.month)}</span>
                <span className="hidden sm:inline">{formatJapaneseMonth(point.month)}</span>
              </span>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>月別の請求額</caption>
        <thead>
          <tr>
            <th scope="col">月</th>
            <th scope="col">請求額</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.month}>
              <th scope="row">{formatJapaneseMonth(point.month)}</th>
              <td>{formatYen(point.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
