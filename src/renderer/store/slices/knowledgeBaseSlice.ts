import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import type { KnowledgeBaseSummary } from '../../types/knowledgeBase';

interface KnowledgeBaseState {
  knowledgeBases: KnowledgeBaseSummary[];
  /** Knowledge bases referenced for the next message (session-scoped, like activeKitIds). */
  activeKbIds: string[];
}

const initialState: KnowledgeBaseState = {
  knowledgeBases: [],
  activeKbIds: [],
};

const knowledgeBaseSlice = createSlice({
  name: 'knowledgeBase',
  initialState,
  reducers: {
    setKnowledgeBases: (state, action: PayloadAction<KnowledgeBaseSummary[]>) => {
      state.knowledgeBases = action.payload;
      // Drop references to knowledge bases that no longer exist
      const ids = new Set(action.payload.map(kb => kb.id));
      state.activeKbIds = state.activeKbIds.filter(id => ids.has(id));
    },
    toggleActiveKnowledgeBase: (state, action: PayloadAction<string>) => {
      const index = state.activeKbIds.indexOf(action.payload);
      if (index === -1) {
        state.activeKbIds.push(action.payload);
      } else {
        state.activeKbIds.splice(index, 1);
      }
    },
    setActiveKnowledgeBaseIds: (state, action: PayloadAction<string[]>) => {
      state.activeKbIds = action.payload;
    },
    clearActiveKnowledgeBases: (state) => {
      state.activeKbIds = [];
    },
  },
});

export const {
  setKnowledgeBases,
  toggleActiveKnowledgeBase,
  setActiveKnowledgeBaseIds,
  clearActiveKnowledgeBases,
} = knowledgeBaseSlice.actions;

export default knowledgeBaseSlice.reducer;
