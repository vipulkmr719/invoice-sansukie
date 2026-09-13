/**
 * Date helpers.
 *
 * Issue dates and due dates are calendar dates, not instants — they are stored
 * in `DATE` columns and must not shift when the server and the reader are in
 * different time zones. Every conversion here therefore goes through UTC.
 */

/** `Date` → `YYYY-MM-DD` (UTC). */
export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → `Date` at UTC midnight. */
export function fromDateInputValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Today, at UTC midnight. */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** First instant of the month containing `date`, in UTC. */
export function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addMonthsUtc(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
}

/** `2026-09-13` → `2026年9月13日` */
export function formatJapaneseDate(value: string | Date): string {
  const date = typeof value === 'string' ? fromDateInputValue(value.slice(0, 10)) : value;
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

/** `2026-09-13` → `2026/09/13` */
export function formatSlashDate(value: string | Date): string {
  const date = typeof value === 'string' ? fromDateInputValue(value.slice(0, 10)) : value;
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}/${month}/${day}`;
}

/** `2026-09` → `2026年9月` */
export function formatJapaneseMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year}年${Number(month)}月`;
}

/** `2026-09` → `9月` — for narrow viewports where the year does not fit. */
export function formatShortMonth(yearMonth: string): string {
  const [, month] = yearMonth.split('-');
  return `${Number(month)}月`;
}

/** True when a due date has passed (compared as calendar dates, in UTC). */
export function isOverdue(dueDate: string | Date): boolean {
  const date =
    typeof dueDate === 'string' ? fromDateInputValue(dueDate.slice(0, 10)) : dueDate;
  return date.getTime() < todayUtc().getTime();
}
