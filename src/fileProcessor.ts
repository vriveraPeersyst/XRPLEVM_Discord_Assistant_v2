// src/fileProcessor.ts

import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

const SUPPORTED_EXTENSIONS = ['.pdf', '.csv'];

/**
 * Converts any non-text files (PDFs or CSVs) to .txt files in the same directory.
 * Returns an array of all newly created .txt file paths.
 */
export async function convertNonTextToTxt(rootDir: string): Promise<string[]> {
  const newTxtFiles: string[] = [];

  async function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;

      const txtPath = fullPath.replace(ext, '.txt');
      if (fs.existsSync(txtPath)) continue;

      let text = '';
      try {
        text = await extractText(fullPath, ext);
      } catch (err) {
        console.error(`⚠️ extractText threw for ${fullPath}:`, err);
        continue;
      }

      if (text.trim().length > 0) {
        try {
          fs.writeFileSync(txtPath, text, 'utf-8');
          newTxtFiles.push(txtPath);
          console.log(`Created text file: ${txtPath}`);
        } catch (writeErr) {
          console.error(`❌ Failed to write ${txtPath}:`, writeErr);
        }
      }
    }
  }

  await walk(rootDir);
  return newTxtFiles;
}

/**
 * Extracts text from a PDF or CSV.
 */
async function extractText(filePath: string, ext: string): Promise<string> {
  const lowerExt = ext.toLowerCase();
  const buffer = await fs.promises.readFile(filePath);

  if (lowerExt === '.pdf') {
    try {
      const pdfData = await pdfParse(buffer);
      return pdfData.text || '';
    } catch (err) {
      console.error(`⚠️ PDF parse failed for ${filePath}:`, err);
      return '';
    }
  }

  if (lowerExt === '.csv') {
    return buffer.toString('utf-8');
  }

  return '';
}

/**
 * Recursively gathers all .txt files under a directory.
 */
export function gatherTextFiles(rootDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (fullPath.toLowerCase().endsWith('.txt')) {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results;
}
