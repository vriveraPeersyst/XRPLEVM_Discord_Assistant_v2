// src/fileProcessor.ts

import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';

const SUPPORTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.csv'];

/**
 * Converts any non-text files (pdf, images, etc.) to .txt files in the same directory.
 * Returns an array of all newly created .txt file paths.
 */
export async function convertNonTextToTxt(rootDir: string): Promise<string[]> {
  const newTxtFiles: string[] = [];

  // Recursively walk the directory
  async function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;

        const txtPath = fullPath.replace(ext, '.txt');
        // Skip if already converted
        if (fs.existsSync(txtPath)) continue;

        let extracted = '';
        try {
          extracted = await extractText(fullPath, ext);
        } catch {
          // If extractText itself throws (unlikely with our catches), skip
          continue;
        }

        if (extracted.trim().length > 0) {
          try {
            fs.writeFileSync(txtPath, extracted, 'utf-8');
            newTxtFiles.push(txtPath);
            console.log(`Created text file: ${txtPath}`);
          } catch {
            // writing failed, but we don't want to crash
          }
        }
      }
    }
  }

  await walk(rootDir);
  return newTxtFiles;
}

/**
 * Reads a file buffer and returns its textual content.
 * - PDF => pdf-parse
 * - Images => Tesseract OCR (errors swallowed)
 * - CSV => raw text
 */
async function extractText(filePath: string, ext: string): Promise<string> {
  const lowerExt = ext.toLowerCase();
  let fileBuffer: Buffer;

  try {
    fileBuffer = await fs.promises.readFile(filePath);
  } catch {
    return '';
  }

  // PDF
  if (lowerExt === '.pdf') {
    try {
      const pdfData = await pdfParse(fileBuffer);
      return pdfData.text || '';
    } catch {
      return '';
    }
  }

  // Images => OCR
  if (['.png', '.jpg', '.jpeg', '.gif'].includes(lowerExt)) {
    try {
      const { data } = await Tesseract.recognize(fileBuffer, 'eng');
      return data.text || '';
    } catch {
      return '';
    }
  }

  // CSV or other text-based
  if (lowerExt === '.csv') {
    return fileBuffer.toString('utf-8');
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
