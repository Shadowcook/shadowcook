import type { ContentStack, Node, NodeQueries, TDocumentDefinitions } from 'pdfmake/interfaces';

interface RecipePdfStepCell extends ContentStack {
  id?: string;
}

export type RecipePdfStepRow = [RecipePdfStepCell, RecipePdfStepCell];

export function createRecipePdfStepPagination(
  rows: RecipePdfStepRow[],
): NonNullable<TDocumentDefinitions['pageBreakBefore']> {
  const rowIndexes: Map<string, number> = new Map<string, number>();
  rows.forEach((row: RecipePdfStepRow, index: number): void => {
    row.forEach((cell: RecipePdfStepCell, column: number): void => {
      cell.id = `recipe-pdf-step-${index}-${column}`;
      rowIndexes.set(cell.id, index);
    });
  });

  return (node: Node, queries: NodeQueries): boolean => {
    const rowIndex: number | undefined =
      node.id === undefined ? undefined : rowIndexes.get(node.id);
    if (rowIndex === undefined) return false;

    const previousNodes: Node[] = queries.getPreviousNodesOnPage();
    const followsAnotherStep: boolean = previousNodes.some((previous: Node): boolean => {
      const previousIndex: number | undefined =
        previous.id === undefined ? undefined : rowIndexes.get(previous.id);
      return previousIndex !== undefined && previousIndex < rowIndex;
    });
    if (!followsAnotherStep) return false;

    const nearbyNodes: Node[] = [
      node,
      ...previousNodes,
      ...queries.getFollowingNodesOnPage(),
      ...queries.getNodesOnNextPage(),
    ];
    const stepPages: Set<number> = new Set<number>();
    nearbyNodes.forEach((candidate: Node): void => {
      if (candidate.id === undefined || rowIndexes.get(candidate.id) !== rowIndex) return;
      candidate.pageNumbers.forEach((page: number): void => {
        stepPages.add(page);
      });
    });
    if (stepPages.size <= 1) return false;

    const row: RecipePdfStepRow = rows[rowIndex]!;
    row[0].pageBreak = 'before';
    row[1].pageBreak = 'before';
    return true;
  };
}
