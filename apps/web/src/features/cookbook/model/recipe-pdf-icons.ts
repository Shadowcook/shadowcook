import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export function recipePdfIconSvg(icon: IconDefinition, color: string = '#302820'): string {
  const width: number = icon.icon[0];
  const height: number = icon.icon[1];
  const pathData: string | string[] = icon.icon[4];
  const paths: string[] = typeof pathData === 'string' ? [pathData] : pathData;
  const svgPaths: string = paths
    .map((path: string): string => `<path fill="${color}" d="${path}" />`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgPaths}</svg>`;
}
