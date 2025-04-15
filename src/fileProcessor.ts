// src/fileProcessor.ts
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';

const SUPPORTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.csv'];

export async function convertNonTextToTxt(rootDir: string): Promise<string[]> {
  const newTxtFiles: string[] = [];
  async function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          const txtPath = fullPath.replace(ext, '.txt');
          if (fs.existsSync(txtPath)) continue;
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

async function extractText(filePath: string, ext: string): Promise<string> {
  const fileBuffer = await fs.promises.readFile(filePath);
  const lowerExt = ext.toLowerCase();
  if (lowerExt === '.pdf') {
    const pdfData = await pdfParse(fileBuffer);
    return pdfData.text || '';
  }
  if (['.png', '.jpg', '.jpeg', '.gif'].includes(lowerExt)) {
    const { data } = await Tesseract.recognize(fileBuffer, 'eng');
    return data.text || '';
  }
  if (lowerExt === '.csv') {
    return fileBuffer.toString('utf-8');
  }
  return '';
}

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
