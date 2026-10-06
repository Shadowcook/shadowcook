export type PaginationItem = number | null;

const maximumPageButtons: number = 10;
const firstPageButtons: number = 1;
const movingWindowPageButtons: number = 5;
const lastPageButtons: number = maximumPageButtons - firstPageButtons - movingWindowPageButtons;

export function frontpagePaginationItems(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  if (totalPages <= maximumPageButtons)
    return Array.from(
      { length: totalPages },
      (_value: unknown, index: number): number => index + 1,
    );

  const lastWindowStart: number = totalPages - lastPageButtons + 1;
  const windowStart: number = Math.min(
    Math.max(currentPage - 1, firstPageButtons + 1),
    lastWindowStart - movingWindowPageButtons,
  );
  const windowEnd: number = windowStart + movingWindowPageButtons - 1;
  const items: PaginationItem[] = [];

  appendPageRange(items, 1, firstPageButtons);
  if (windowStart > firstPageButtons + 1) items.push(null);
  appendPageRange(items, windowStart, windowEnd);
  if (windowEnd < lastWindowStart - 1) items.push(null);
  appendPageRange(items, Math.max(lastWindowStart, windowEnd + 1), totalPages);
  return items;
}

export function compactPaginationItems(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  if (totalPages <= 5)
    return Array.from(
      { length: totalPages },
      (_value: unknown, index: number): number => index + 1,
    );

  const items: PaginationItem[] = [1];
  const windowStart: number = Math.max(2, Math.min(currentPage - 1, totalPages - 3));
  const windowEnd: number = Math.min(totalPages - 1, windowStart + 2);

  if (windowStart > 2) items.push(null);
  appendPageRange(items, windowStart, windowEnd);
  if (windowEnd < totalPages - 1) items.push(null);
  items.push(totalPages);
  return items;
}

function appendPageRange(items: PaginationItem[], start: number, end: number): void {
  for (let page: number = start; page <= end; page += 1) items.push(page);
}
