import type { JSX } from 'react';

type IconName =
  | 'add'
  | 'aliases'
  | 'copy'
  | 'delete'
  | 'default'
  | 'disable'
  | 'edit'
  | 'enable'
  | 'moveDown'
  | 'moveUp'
  | 'roles'
  | 'resetPassword'
  | 'share';

export default function AdminIcon({ name }: { name: IconName }): JSX.Element {
  let content: JSX.Element;
  if (name === 'add') content = <path d="M12 5v14M5 12h14" />;
  else if (name === 'copy')
    content = (
      <>
        <rect x="8" y="8" width="11" height="12" rx="1" />
        <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      </>
    );
  else if (name === 'default')
    content = (
      <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 4Z" />
    );
  else if (name === 'edit') content = <path d="m6 18 2.5-.5L18 8l-2-2-9.5 9.5L6 18Z" />;
  else if (name === 'delete') content = <path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12" />;
  else if (name === 'disable') content = <path d="M7 5v14M17 5v14" />;
  else if (name === 'enable') content = <path d="m9 5 10 7-10 7V5Z" />;
  else if (name === 'resetPassword') content = <path d="M19 8a7 7 0 1 0 1 5M19 4v4h-4" />;
  else if (name === 'share')
    content = (
      <path d="M18 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM18 21.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.3 10.9l7.4-4.2m-7.4 6.4 7.4 4.2" />
    );
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
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={name === 'edit' ? 'admin-icon admin-icon--edit' : 'admin-icon'}
    >
      {content}
    </svg>
  );
}
