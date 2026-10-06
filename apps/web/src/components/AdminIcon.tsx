import type { JSX } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowDown,
  faArrowUp,
  faBars,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCodeMerge,
  faCopy,
  faKey,
  faPause,
  faPen,
  faPlay,
  faPlus,
  faShareNodes,
  faStar,
  faTags,
  faTrashCan,
  faUsers,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

type IconName =
  | 'add'
  | 'aliases'
  | 'close'
  | 'categoryCollapsed'
  | 'categoryExpanded'
  | 'copy'
  | 'consolidate'
  | 'delete'
  | 'default'
  | 'disable'
  | 'edit'
  | 'enable'
  | 'expand'
  | 'moveDown'
  | 'moveUp'
  | 'menu'
  | 'next'
  | 'previous'
  | 'roles'
  | 'resetPassword'
  | 'share';

const iconByName: Readonly<Record<IconName, IconDefinition>> = {
  add: faPlus,
  aliases: faTags,
  close: faXmark,
  categoryCollapsed: faChevronRight,
  categoryExpanded: faChevronDown,
  copy: faCopy,
  consolidate: faCodeMerge,
  default: faStar,
  delete: faTrashCan,
  disable: faPause,
  edit: faPen,
  enable: faPlay,
  expand: faChevronDown,
  moveDown: faArrowDown,
  moveUp: faArrowUp,
  menu: faBars,
  next: faChevronRight,
  previous: faChevronLeft,
  resetPassword: faKey,
  roles: faUsers,
  share: faShareNodes,
};

export default function AdminIcon({ name }: { name: IconName }): JSX.Element {
  return (
    <FontAwesomeIcon
      aria-hidden="true"
      className={name === 'edit' ? 'admin-icon admin-icon--edit' : 'admin-icon'}
      icon={iconByName[name]}
    />
  );
}
