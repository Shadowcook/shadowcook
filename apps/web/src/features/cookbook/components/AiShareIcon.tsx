import type { JSX } from 'react';
import AdminIcon from '../../../components/AdminIcon';

interface AiShareIconProperties {
  label: string;
}

export default function AiShareIcon({ label }: AiShareIconProperties): JSX.Element {
  return (
    <span className="ai-share-icon" aria-hidden="true">
      <span className="ai-share-icon__label">
        {Array.from(label).map((character: string, index: number): JSX.Element => (
          <span key={`${character}-${index}`}>{character}</span>
        ))}
      </span>
      <AdminIcon name="share" />
    </span>
  );
}
