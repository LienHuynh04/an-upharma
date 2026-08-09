export interface SalesMonthKeyed {
  key: string;
}

export interface CompletedMonthRange {
  start: Date;
  end: Date;
}

export function getCompletedMonthKeys(monthCount = 3, now = new Date()): string[] {
  const safeMonthCount = Math.max(0, Math.floor(monthCount));
  const keys: string[] = [];

  for (let offset = safeMonthCount; offset >= 1; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }

  return keys;
}

export function selectCompletedMonths<T extends SalesMonthKeyed>(
  months: T[],
  monthCount = 3,
  now = new Date(),
): T[] | null {
  const monthByKey = new Map(months.map((month) => [month.key, month]));
  const selectedMonths = getCompletedMonthKeys(monthCount, now).map((key) => monthByKey.get(key));

  return selectedMonths.every((month): month is T => Boolean(month)) ? selectedMonths : null;
}

export function getCompletedMonthRange(monthCount = 3, now = new Date()): CompletedMonthRange {
  const safeMonthCount = Math.max(1, Math.floor(monthCount));

  return {
    start: new Date(now.getFullYear(), now.getMonth() - safeMonthCount, 1, 0, 0, 0, 0),
    end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
  };
}
