/**
 * Import-time text extraction for knowledge base documents.
 *
 * The OpenClaw memory indexer only indexes markdown files, so rich formats
 * (docx/xlsx/pdf) are converted to plain-text markdown at import time.
 * All converters rely on dependencies that already ship with the app:
 * extract-zip (docx), SheetJS `xlsx` (xlsx/xls), pdfjs-dist (pdf).
 */

import extractZip from 'extract-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TAG = '[KnowledgeBase]';

/** Extensions that require conversion (everything else is passthrough text). */
export const CONVERTIBLE_EXTENSIONS = new Set(['.docx', '.xlsx', '.xls', '.pdf']);
export const PASSTHROUGH_EXTENSIONS = new Set(['.md', '.txt', '.csv']);

export function isSupportedImportExtension(extension: string): boolean {
  return PASSTHROUGH_EXTENSIONS.has(extension) || CONVERTIBLE_EXTENSIONS.has(extension);
}

// ---------------------------------------------------------------------------
// docx — a zip container; the document body lives in word/document.xml
// ---------------------------------------------------------------------------

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

/** Convert word/document.xml body markup to plain text (paragraphs + tabs). */
export function extractDocxXmlText(documentXml: string): string {
  const paragraphs: string[] = [];
  const paragraphRe = /<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  for (const match of documentXml.match(paragraphRe) ?? []) {
    const parts: string[] = [];
    // `<w:t>` must be matched as an exact tag name (`<w:t>` or `<w:t attr...>`),
    // otherwise `<w:tab/>` would be consumed by the text branch.
    const runRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
    let m: RegExpExecArray | null;
    while ((m = runRe.exec(match)) !== null) {
      if (m[0] === '<w:tab/>') parts.push('\t');
      else if (m[0] === '<w:br/>') parts.push('\n');
      else parts.push(decodeXmlEntities(m[1] ?? ''));
    }
    paragraphs.push(parts.join(''));
  }
  return paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function convertDocx(sourcePath: string): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-docx-'));
  try {
    await extractZip(sourcePath, { dir: tempDir });
    const documentXmlPath = path.join(tempDir, 'word', 'document.xml');
    const xml = fs.readFileSync(documentXmlPath, 'utf8');
    return extractDocxXmlText(xml);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup; the OS temp dir is purged eventually.
    }
  }
}

// ---------------------------------------------------------------------------
// xlsx / xls — SheetJS, one markdown section per sheet (CSV body)
// ---------------------------------------------------------------------------

function convertWorkbook(sourcePath: string): string {
   
  const XLSX = require('xlsx') as typeof import('xlsx');
  const workbook = XLSX.readFile(sourcePath, { dense: true });
  const sections: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet).trim();
    if (!csv) continue;
    sections.push(`## ${sheetName}\n\n${csv}`);
  }
  return sections.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// pdf — pdfjs-dist legacy build, page-by-page text content
// ---------------------------------------------------------------------------

/**
 * pdfjs-dist v4 ships ESM only. The Electron main bundle is CJS, and tsc
 * would rewrite a plain `import()` into `require()`, which cannot load ESM —
 * so the dynamic import goes through `new Function` to survive transpilation.
 */
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

async function convertPdf(sourcePath: string): Promise<string> {
  const pdfjs = await importEsm('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(sourcePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = (content.items as Array<{ str?: string; hasEOL?: boolean }>)
        .map(item => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`)
        .join('')
        .trim();
      if (text) pages.push(text);
    }
    return pages.join('\n\n').trim();
  } finally {
    try {
      await doc.destroy();
    } catch {
      // Ignore cleanup failures; the document data is already extracted.
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Extract markdown-ready text from a rich-format source file.
 * Throws on parse failure — callers map that to a `convertFailed` result.
 */
export async function convertImportSourceToText(sourcePath: string, extension: string): Promise<string> {
  switch (extension) {
    case '.docx':
      return convertDocx(sourcePath);
    case '.xlsx':
    case '.xls':
      return convertWorkbook(sourcePath);
    case '.pdf':
      return convertPdf(sourcePath);
    default:
      throw new Error(`${TAG} no converter for extension: ${extension}`);
  }
}
