import { BookOpenIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { toggleActiveKnowledgeBase } from '../../store/slices/knowledgeBaseSlice';
import XMarkIcon from '../icons/XMarkIcon';

const ActiveKnowledgeBaseBadge: React.FC = () => {
  const dispatch = useDispatch();
  const activeKbIds = useSelector((state: RootState) => state.knowledgeBase.activeKbIds);
  const knowledgeBases = useSelector((state: RootState) => state.knowledgeBase.knowledgeBases);

  const activeKbs = activeKbIds
    .map(id => knowledgeBases.find(kb => kb.id === id))
    .filter((kb): kb is NonNullable<typeof kb> => kb !== undefined);

  if (activeKbs.length === 0) return null;

  const handleRemove = (e: React.MouseEvent, kbId: string) => {
    e.stopPropagation();
    dispatch(toggleActiveKnowledgeBase(kbId));
  };

  return (
    <>
      {activeKbs.map(kb => (
        <button
          type="button"
          key={kb.id}
          onClick={(e) => handleRemove(e, kb.id)}
          className="group inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-primary-muted px-2.5 text-[13px] font-normal leading-none text-foreground transition-all hover:bg-primary/15 hover:ring-1 hover:ring-primary/30"
          title={i18nService.t('kbClearReference')}
        >
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors group-hover:bg-primary/15">
            <BookOpenIcon className="h-3.5 w-3.5 text-primary transition-opacity group-hover:opacity-0" />
            <XMarkIcon className="absolute h-3 w-3 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="min-w-0 truncate">{kb.name}</span>
        </button>
      ))}
    </>
  );
};

export default ActiveKnowledgeBaseBadge;
