import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

import { extractDocxXmlText } from './knowledgeBaseImportConverters';
import {
  collectImportFiles,
  createKnowledgeBase,
  deleteDoc,
  deleteKnowledgeBase,
  ensureKnowledgeBasesRoot,
  getKnowledgeBasesRoot,
  importDocs,
  listDocs,
  listKnowledgeBases,
  readDoc,
  renameKnowledgeBase,
} from './knowledgeBaseManager';

let stateDir: string;
let root: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-kb-test-'));
  root = ensureKnowledgeBasesRoot(stateDir);
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function writeSourceFile(name: string, content: string): string {
  const filePath = path.join(stateDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ==================== root & CRUD ====================

test('getKnowledgeBasesRoot resolves under the state dir', () => {
  expect(getKnowledgeBasesRoot(stateDir)).toBe(path.join(stateDir, 'knowledge-bases'));
  expect(fs.existsSync(root)).toBe(true);
});

test('create/list/rename knowledge bases', () => {
  const created = createKnowledgeBase(root, '  前端  规范  ');
  expect(created.name).toBe('前端 规范');
  expect(created.docCount).toBe(0);
  expect(created.path).toBe(path.join(root, created.id));

  const listed = listKnowledgeBases(root);
  expect(listed.length).toBe(1);
  expect(listed[0].id).toBe(created.id);

  const renamed = renameKnowledgeBase(root, created.id, '新名字');
  expect(renamed.name).toBe('新名字');
  expect(listKnowledgeBases(root)[0].name).toBe('新名字');
});

test('create rejects empty names and truncates long names', () => {
  expect(() => createKnowledgeBase(root, '   ')).toThrow();
  const longName = 'x'.repeat(200);
  expect(createKnowledgeBase(root, longName).name.length).toBe(64);
});

test('listKnowledgeBases ignores directories without a valid kb.json', () => {
  fs.mkdirSync(path.join(root, 'random-dir'));
  fs.writeFileSync(path.join(root, 'random-dir', 'kb.json'), 'not json', 'utf8');
  fs.mkdirSync(path.join(root, 'no-meta-dir'));
  expect(listKnowledgeBases(root).length).toBe(0);
});

test('deleteKnowledgeBase removes the directory but refuses non-KB dirs', () => {
  const kb = createKnowledgeBase(root, 'to-delete');
  fs.mkdirSync(path.join(root, 'not-a-kb'));

  expect(deleteKnowledgeBase(root, 'not-a-kb')).toBe(false);
  expect(fs.existsSync(path.join(root, 'not-a-kb'))).toBe(true);

  expect(deleteKnowledgeBase(root, kb.id)).toBe(true);
  expect(fs.existsSync(path.join(root, kb.id))).toBe(false);
});

// ==================== path safety ====================

test('rejects ids and file names that escape the root', () => {
  const kb = createKnowledgeBase(root, 'safe');
  expect(() => listDocs(root, '..')).toThrow();
  expect(() => listDocs(root, '../outside')).toThrow();
  expect(() => listDocs(root, 'a/b')).toThrow();
  expect(() => readDoc(root, kb.id, '../kb.json')).toThrow();
  expect(() => readDoc(root, kb.id, 'nested\\doc.md')).toThrow();
  expect(() => deleteDoc(root, kb.id, 'kb.json')).toThrow(); // not .md
});

// ==================== import ====================

test('importDocs imports md, txt and csv as passthrough text', async () => {
  const kb = createKnowledgeBase(root, 'docs');
  const mdPath = writeSourceFile('guide.md', '# Guide\ncontent');
  const txtPath = writeSourceFile('notes.txt', 'plain notes');
  const csvPath = writeSourceFile('table.csv', 'a,b\n1,2');

  const results = await importDocs(root, kb.id, [mdPath, txtPath, csvPath]);
  expect(results.every(r => r.success)).toBe(true);
  expect(results[0].fileName).toBe('guide.md');
  expect(results[1].fileName).toBe('notes.md');
  expect(results[2].fileName).toBe('table.md');

  const docs = listDocs(root, kb.id);
  expect(docs.length).toBe(3);
  expect(readDoc(root, kb.id, 'notes.md')).toBe('plain notes');
  expect(readDoc(root, kb.id, 'table.md')).toBe('a,b\n1,2');
  expect(listKnowledgeBases(root)[0].docCount).toBe(3);
});

test('importDocs sanitizes names and resolves collisions with suffixes', async () => {
  const kb = createKnowledgeBase(root, 'docs');
  const first = writeSourceFile('my doc.md', 'one');
  fs.mkdirSync(path.join(stateDir, 'sub'));
  const second = path.join(stateDir, 'sub', 'my doc.md');
  fs.writeFileSync(second, 'two', 'utf8');

  const results = await importDocs(root, kb.id, [first, second]);
  expect(results[0].fileName).toBe('my-doc.md');
  expect(results[1].fileName).toBe('my-doc-1.md');
  expect(readDoc(root, kb.id, 'my-doc-1.md')).toBe('two');
});

test('importDocs reports unsupported, oversized and unreadable files without aborting the batch', async () => {
  const kb = createKnowledgeBase(root, 'docs');
  const exe = writeSourceFile('a.exe', 'binary');
  const big = writeSourceFile('big.md', 'x'.repeat(5 * 1024 * 1024 + 1));
  const missing = path.join(stateDir, 'missing.md');
  const ok = writeSourceFile('ok.md', 'fine');

  const results = await importDocs(root, kb.id, [exe, big, missing, ok]);
  expect(results[0]).toMatchObject({ success: false, errorCode: 'unsupported' });
  expect(results[1]).toMatchObject({ success: false, errorCode: 'tooLarge' });
  expect(results[2]).toMatchObject({ success: false, errorCode: 'readFailed' });
  expect(results[3].success).toBe(true);
  expect(listDocs(root, kb.id).length).toBe(1);
});

// ==================== folder import ====================

test('collectImportFiles walks folders, keeps supported + .doc, skips others and hidden entries', () => {
  const folder = path.join(stateDir, 'import-src');
  fs.mkdirSync(path.join(folder, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(folder, '.hidden-dir'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'a.md'), 'a', 'utf8');
  fs.writeFileSync(path.join(folder, 'b.png'), 'img', 'utf8');
  fs.writeFileSync(path.join(folder, 'legacy.doc'), 'doc', 'utf8');
  fs.writeFileSync(path.join(folder, '.hidden.md'), 'h', 'utf8');
  fs.writeFileSync(path.join(folder, '.hidden-dir', 'c.md'), 'c', 'utf8');
  fs.writeFileSync(path.join(folder, 'nested', 'd.txt'), 'd', 'utf8');
  const explicitUnsupported = writeSourceFile('direct.exe', 'x');

  const candidates = collectImportFiles([folder, explicitUnsupported]);
  const names = candidates.files.map(f => path.basename(f)).sort();
  // Folder scan keeps supported + .doc; explicit files are always kept.
  expect(names).toEqual(['a.md', 'd.txt', 'direct.exe', 'legacy.doc']);
  expect(candidates.skipped).toBe(1); // b.png
  expect(candidates.truncated).toBe(false);
});

test('collectImportFiles keeps nonexistent explicit paths for downstream error reporting', () => {
  const missing = path.join(stateDir, 'missing.md');
  const candidates = collectImportFiles([missing]);
  expect(candidates.files).toEqual([missing]);
});

test('importDocs reports progress per file', async () => {
  const kb = createKnowledgeBase(root, 'docs');
  const a = writeSourceFile('p1.md', 'one');
  const b = writeSourceFile('p2.md', 'two');

  const events: Array<{ done: number; total: number; name: string }> = [];
  await importDocs(root, kb.id, [a, b], (done, total, sourcePath) => {
    events.push({ done, total, name: path.basename(sourcePath) });
  });
  expect(events).toEqual([
    { done: 0, total: 2, name: 'p1.md' },
    { done: 1, total: 2, name: 'p2.md' },
  ]);
});

// ==================== rich-format conversion ====================

test('importDocs converts xlsx workbooks to per-sheet markdown', async () => {
  const kb = createKnowledgeBase(root, 'docs');
   
  const XLSX = require('xlsx') as typeof import('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['名称', '值'], ['代理地址', 'proxy:8080']]),
    '配置表',
  );
  const xlsxPath = path.join(stateDir, 'config.xlsx');
  XLSX.writeFile(workbook, xlsxPath);

  const results = await importDocs(root, kb.id, [xlsxPath]);
  expect(results[0].success).toBe(true);
  const content = readDoc(root, kb.id, results[0].fileName!);
  expect(content).toContain('## 配置表');
  expect(content).toContain('代理地址,proxy:8080');
});

test('importDocs reports convertFailed for corrupt rich-format files', async () => {
  const kb = createKnowledgeBase(root, 'docs');
  const badDocx = writeSourceFile('broken.docx', 'not a zip');
  const badPdf = writeSourceFile('broken.pdf', 'not a pdf');

  const results = await importDocs(root, kb.id, [badDocx, badPdf]);
  expect(results[0]).toMatchObject({ success: false, errorCode: 'convertFailed' });
  expect(results[1]).toMatchObject({ success: false, errorCode: 'convertFailed' });
  expect(listDocs(root, kb.id).length).toBe(0);
});

test('importDocs reports legacyDoc for old .doc files', async () => {
  const kb = createKnowledgeBase(root, 'docs');
  const doc = writeSourceFile('report.doc', 'legacy binary');

  const results = await importDocs(root, kb.id, [doc]);
  expect(results[0]).toMatchObject({ success: false, errorCode: 'legacyDoc' });
  expect(listDocs(root, kb.id).length).toBe(0);
});

test('extractDocxXmlText flattens paragraphs, tabs and line breaks', () => {
  const xml = [
    '<w:document><w:body>',
    '<w:p><w:r><w:t>第一段</w:t></w:r><w:tab/><w:r><w:t>续</w:t></w:r></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">A &amp; B</w:t></w:r><w:br/><w:r><w:t>C</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join('');
  expect(extractDocxXmlText(xml)).toBe('第一段\t续\nA & B\nC');
});

// ==================== docs ====================

test('deleteDoc removes a document and updates docCount', async () => {
  const kb = createKnowledgeBase(root, 'docs');
  const mdPath = writeSourceFile('doc.md', 'content');
  await importDocs(root, kb.id, [mdPath]);

  expect(deleteDoc(root, kb.id, 'doc.md')).toBe(true);
  expect(deleteDoc(root, kb.id, 'doc.md')).toBe(false);
  expect(listDocs(root, kb.id).length).toBe(0);
  expect(listKnowledgeBases(root)[0].docCount).toBe(0);
});

test('listDocs excludes kb.json and non-markdown files', async () => {
  const kb = createKnowledgeBase(root, 'docs');
  fs.writeFileSync(path.join(root, kb.id, 'stray.bin'), 'bin', 'utf8');
  const mdPath = writeSourceFile('doc.md', 'content');
  await importDocs(root, kb.id, [mdPath]);

  const docs = listDocs(root, kb.id);
  expect(docs.map(d => d.fileName)).toEqual(['doc.md']);
});
