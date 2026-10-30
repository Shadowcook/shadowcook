import type { CustomTableLayout } from 'pdfmake/interfaces';

interface RecipePdfTableLayout extends CustomTableLayout {
  hLineWhenBroken: boolean;
}

export const recipePdfTableLayout: RecipePdfTableLayout = {
  hLineWidth: (row: number): number => (row === 0 ? 0 : 0.5),
  hLineWhenBroken: false,
  vLineWidth: (): number => 0,
  hLineColor: '#d9d3cd',
  paddingLeft: (): number => 0,
  paddingRight: (): number => 12,
  paddingTop: (): number => 10,
  paddingBottom: (): number => 10,
};
