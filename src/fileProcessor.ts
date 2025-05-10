// src/fileProcessor.ts

import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { fileTypeFromBuffer } from 'file-type';
import { chunkText } from './chunker';

const SUPPORTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.csv'];

/**
 * Converts any non-text files (PDFs or CSVs) to .txt files in the same directory.
 * Returns an array of all newly created .txt file paths.
 */
export async function convertNonTextToTxt(rootDir: string): Promise<string[]> {
  const newTxtFiles: string[] = [];

  async function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;
        const raw = await fs.promises.readFile(full);
        let extracted = '';

        if (ext === '.pdf') {
          const pdfData = await pdfParse(raw);
          extracted = pdfData.text || '';
        } else if (['.png', '.jpg', '.jpeg', '.gif'].includes(ext)) {
          const type = await fileTypeFromBuffer(raw);
          if (!type || !type.mime.startsWith('image/')) {
            console.warn(`Skipping non-image file: ${full}`);
            continue;
          }
          try {
            const { data } = await Tesseract.recognize(raw, 'eng');
            extracted = data.text || '';
          } catch (err) {
            console.warn(`Tesseract failed on ${full}:`, err);
            continue;
          }
        } else if (ext === '.csv') {
          extracted = raw.toString('utf-8');
        }

        if (extracted.trim()) {
          const chunks = chunkText(extracted);
          chunks.forEach((chunk, i) => {
            const out = full.replace(ext, `_chunk${i}.txt`);
            fs.writeFileSync(out, chunk, 'utf-8');
            newTxtFiles.push(out);
          });
        }
      }
    }
  }

  await walk(rootDir);
  return newTxtFiles;
}

/**
 * Recursively gathers all .txt files under a directory.
 */
export function gatherTextFiles(rootDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.endsWith('.txt')) out.push(full);
    }
  }
  walk(rootDir);
  return out;
}
