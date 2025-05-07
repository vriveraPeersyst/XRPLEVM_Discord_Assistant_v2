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

        // Safely attempt to extract text
        let extracted = '';
        try {
          extracted = await extractText(fullPath, ext);
        } catch (err) {
          console.error(`⚠️ extractText threw for ${fullPath}:`, err);
          continue;
        }

        // Write out only if there's something useful
        if (extracted.trim().length > 0) {
          try {
            fs.writeFileSync(txtPath, extracted, 'utf-8');
            newTxtFiles.push(txtPath);
            console.log(`Created text file: ${txtPath}`);
          } catch (writeErr) {
            console.error(`❌ Failed to write ${txtPath}:`, writeErr);
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
 * - Images => Tesseract OCR (with internal try/catch)
 * - CSV => raw text
 */
async function extractText(filePath: string, ext: string): Promise<string> {
  const lowerExt = ext.toLowerCase();
  const fileBuffer = await fs.promises.readFile(filePath);

  // PDF
  if (lowerExt === '.pdf') {
    const pdfData = await pdfParse(fileBuffer);
    return pdfData.text || '';
  }

  // Images => OCR
  if (['.png', '.jpg', '.jpeg', '.gif'].includes(lowerExt)) {
    try {
      const { data } = await Tesseract.recognize(fileBuffer, 'eng');
      return data.text || '';
    } catch (ocrErr) {
      console.error(`⚠️ OCR failed for ${filePath}:`, ocrErr);
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
