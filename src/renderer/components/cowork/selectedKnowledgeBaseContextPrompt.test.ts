import { describe, expect, it } from 'vitest';

import type { KnowledgeBaseSummary } from '../../types/knowledgeBase';
import { buildSelectedKnowledgeBaseContextPrompt } from './selectedKnowledgeBaseContextPrompt';

const makeKb = (overrides: Partial<KnowledgeBaseSummary> = {}): KnowledgeBaseSummary => ({
  id: 'kb-1',
  name: '前端规范',
  path: 'C:\\state\\knowledge-bases\\kb-1',
  docCount: 3,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe('buildSelectedKnowledgeBaseContextPrompt', () => {
  it('returns undefined when nothing is selected', () => {
    expect(buildSelectedKnowledgeBaseContextPrompt([], [makeKb()])).toBeUndefined();
  });

  it('returns undefined when selected ids no longer exist', () => {
    expect(buildSelectedKnowledgeBaseContextPrompt(['gone'], [makeKb()])).toBeUndefined();
  });

  it('renders name, path and doc count for a selected knowledge base', () => {
    const prompt = buildSelectedKnowledgeBaseContextPrompt(['kb-1'], [makeKb()]);
    expect(prompt).toContain('<selected_knowledge_bases>');
    expect(prompt).toContain('<name>前端规范</name>');
    expect(prompt).toContain('<path>C:\\state\\knowledge-bases\\kb-1</path>');
    expect(prompt).toContain('<docs count="3" />');
    expect(prompt).toContain('memory_search');
  });

  it('escapes XML special characters in names and paths', () => {
    const prompt = buildSelectedKnowledgeBaseContextPrompt(
      ['kb-1'],
      [makeKb({ name: 'a<b>&"c"', path: '/tmp/kb & docs' })],
    );
    expect(prompt).toContain('<name>a&lt;b&gt;&amp;"c"</name>');
    expect(prompt).toContain('<path>/tmp/kb &amp; docs</path>');
  });

  it('renders multiple knowledge bases in selection order', () => {
    const kbs = [
      makeKb({ id: 'kb-1', name: 'First' }),
      makeKb({ id: 'kb-2', name: 'Second' }),
    ];
    const prompt = buildSelectedKnowledgeBaseContextPrompt(['kb-2', 'kb-1'], kbs);
    expect(prompt).toBeDefined();
    const secondIdx = prompt!.indexOf('<name>Second</name>');
    const firstIdx = prompt!.indexOf('<name>First</name>');
    expect(secondIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeGreaterThan(secondIdx);
  });
});
