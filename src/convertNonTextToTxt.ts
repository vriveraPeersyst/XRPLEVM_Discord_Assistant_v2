// src/convertNonTextToTxt.ts

import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';

/**
 * Extensions you want to convert from:
 *   - PDFs => text
 *   - Images => OCR via Tesseract
 *   - CSV => plain text
 */
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
        // Check if the file extension is one we want to convert
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          const txtPath = fullPath.replace(ext, '.txt');
          // Skip if the .txt file already exists (avoid reprocessing)
          if (fs.existsSync(txtPath)) {
            continue;
          }

          try {
            const text = await extractText(fullPath, ext);
            if (text && text.trim().length > 0) {
              fs.writeFileSync(txtPath, text, 'utf-8');
              newTxtFiles.push(txtPath);
              console.log(`Created text file: ${txtPath}`);
            }
          } catch (err) {
            console.error(`Failed to convert ${fullPath}:`, err);
          }
        }
      }
    }
  }

  await walk(rootDir);
  return newTxtFiles;
}

/**
 * Reads a file asynchronously and returns its text content.
 * - PDF: uses pdf-parse
 * - Images: uses Tesseract OCR
 * - CSV: read as raw text
 */
async function extractText(filePath: string, ext: string): Promise<string> {
  const lowerExt = ext.toLowerCase();
  // We'll read file data as a Buffer if needed
  const fileBuffer = await fs.promises.readFile(filePath);

  // 1) PDF
  if (lowerExt === '.pdf') {
    const pdfData = await pdfParse(fileBuffer);
    return pdfData.text || '';
  }

  // 2) Images -> Tesseract OCR
  if (['.png', '.jpg', '.jpeg', '.gif'].includes(lowerExt)) {
    const { data } = await Tesseract.recognize(fileBuffer, 'eng');
    return data.text || '';
  }

  // 3) CSV (or other text-based formats)
  if (lowerExt === '.csv') {
    return fileBuffer.toString('utf-8');
  }

  return ''; // fallback
}
