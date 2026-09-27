import type { JSX } from 'react';

type IconName =
  | 'add'
  | 'aliases'
  | 'delete'
  | 'disable'
  | 'edit'
  | 'enable'
  | 'moveDown'
  | 'moveUp'
  | 'roles'
  | 'resetPassword';

export default function AdminIcon({ name }: { name: IconName }): JSX.Element {
  let content: JSX.Element;
  if (name === 'add') content = <path d="M12 5v14M5 12h14" />;
  else if (name === 'edit') content = <path d="m6 18 2.5-.5L18 8l-2-2-9.5 9.5L6 18Z" />;
  else if (name === 'delete') content = <path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12" />;
  else if (name === 'disable') content = <path d="M7 5v14M17 5v14" />;
  else if (name === 'enable') content = <path d="m9 5 10 7-10 7V5Z" />;
  else if (name === 'resetPassword') content = <path d="M19 8a7 7 0 1 0 1 5M19 4v4h-4" />;
  else if (name === 'roles')
    content = (
      <path d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7-1a2.5 2.5 0 1 0 0-5M3.5 19c.4-3 2.1-5 5-5s4.6 2 5 5M14 14c2.8 0 4.7 1.7 5.2 4" />
    );
  else if (name === 'moveUp') content = <path d="M12 19V5m-5 5 5-5 5 5" />;
  else if (name === 'moveDown') content = <path d="M12 5v14m-5-5 5 5 5-5" />;
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
