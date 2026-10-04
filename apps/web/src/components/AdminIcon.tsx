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

const iconPathByName: Readonly<Record<IconName, string>> = {
  add: '/font-awesome/solid/plus.svg',
  aliases: '/font-awesome/solid/tags.svg',
  copy: '/font-awesome/solid/copy.svg',
  default: '/font-awesome/solid/star.svg',
  delete: '/font-awesome/solid/trash-can.svg',
  disable: '/font-awesome/solid/pause.svg',
  edit: '/font-awesome/solid/pen.svg',
  enable: '/font-awesome/solid/play.svg',
  moveDown: '/font-awesome/solid/arrow-down.svg',
  moveUp: '/font-awesome/solid/arrow-up.svg',
  resetPassword: '/font-awesome/solid/key.svg',
  roles: '/font-awesome/solid/users.svg',
  share: '/font-awesome/solid/share-nodes.svg',
};

export default function AdminIcon({ name }: { name: IconName }): JSX.Element {
  return (
    <img
      aria-hidden="true"
      alt=""
      className={name === 'edit' ? 'admin-icon admin-icon--edit' : 'admin-icon'}
      src={iconPathByName[name]}
    />
  );
}
