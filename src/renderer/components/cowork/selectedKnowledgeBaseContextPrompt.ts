import type { KnowledgeBaseSummary } from '../../types/knowledgeBase';

const MAX_NAME_LENGTH = 128;

const escapeXmlText = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const normalizePromptText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const truncateText = (value: string, maxLength: number): string => {
  const normalized = normalizePromptText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

/**
 * Build the per-turn context block for user-referenced knowledge bases.
 *
 * Knowledge base documents are globally indexed by memory_search (via
 * memorySearch.extraPaths), so this block only focuses the agent on the
 * referenced bases; it also carries the directory path as a fallback for
 * direct file reads when memory search is unavailable.
 */
export const buildSelectedKnowledgeBaseContextPrompt = (
  kbIds: string[],
  knowledgeBases: KnowledgeBaseSummary[],
): string | undefined => {
  const selected = kbIds
    .map(id => knowledgeBases.find(kb => kb.id === id))
    .filter((kb): kb is KnowledgeBaseSummary => kb !== undefined);
  if (selected.length === 0) return undefined;

  const entries = selected.map(kb => [
    '  <knowledgeBase>',
    `    <name>${escapeXmlText(truncateText(kb.name, MAX_NAME_LENGTH))}</name>`,
    `    <path>${escapeXmlText(kb.path)}</path>`,
    `    <docs count="${kb.docCount}" />`,
    '  </knowledgeBase>',
  ].join('\n'));

  return [
    '## Referenced knowledge bases for this turn',
    'The user referenced these private knowledge bases and expects answers grounded in them.',
    '<selected_knowledge_bases>',
    ...entries,
    '</selected_knowledge_bases>',
    'Retrieval: call `memory_search` with terms from the user\'s question and prefer results whose `path` is under a referenced knowledge base directory. If memory search is unavailable or returns nothing relevant, read the markdown files under the directory directly.',
  ].join('\n');
};
