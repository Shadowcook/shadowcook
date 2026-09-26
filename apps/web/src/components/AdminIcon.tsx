import type { JSX } from 'react';

type IconName =
  'add' | 'aliases' | 'delete' | 'disable' | 'edit' | 'enable' | 'moveDown' | 'moveUp';

export default function AdminIcon({ name }: { name: IconName }): JSX.Element {
  let content: JSX.Element;
  if (name === 'add') content = <path d="M12 5v14M5 12h14" />;
  else if (name === 'edit')
    content = <path d="M4 16.5V20h3.5L18.2 9.3l-3.5-3.5L4 16.5Z M13.7 6.8l3.5 3.5" />;
  else if (name === 'delete')
    content = <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />;
  else if (name === 'disable') content = <path d="M7 5v14M17 5v14" />;
  else if (name === 'enable') content = <path d="m9 5 10 7-10 7V5Z" />;
  else if (name === 'moveUp') content = <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />;
  else if (name === 'moveDown') content = <path d="M12 5v14M6.5 13.5 12 19l5.5-5.5" />;
  else
    content = (
      <>
        <rect x="4" y="5" width="16" height="5" rx="1" />
        <rect x="4" y="14" width="16" height="5" rx="1" />
      </>
    );
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="admin-icon">
      {content}
    </svg>
  );
}
