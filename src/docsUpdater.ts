// src/docsUpdater.ts
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

// We'll import the config file (JSON) that lists the repos:
import reposConfig from '../repos.config.json';
// ^ Adjust the relative path if needed

const localManualFolder = path.join(__dirname, '..', 'ManualFolder');

// Ensure we have a local folder to store manual docs and cloned repos
if (!fs.existsSync(localManualFolder)) {
  fs.mkdirSync(localManualFolder, { recursive: true });
}

// Vector store config
const VECTOR_ENDPOINT = process.env.VECTOR_ENDPOINT!;
const VECTOR_API_KEY = process.env.VECTOR_API_KEY!;

/**
 * Compute a stable ID (SHA256) for a file
 */
function computeDocumentId(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Check if a document ID already exists in the vector store
 */
async function checkInVectorStore(id: string): Promise<boolean> {
  const url = `${VECTOR_ENDPOINT}/vectors/${id}`;
  try {
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${VECTOR_API_KEY}` }
    });
    return resp.status === 200;
  } catch (err: any) {
    if (err.response && err.response.status === 404) return false;
    throw err;
  }
}

/**
 * Upload (upsert) a document to the vector store
 */
async function uploadToVectorStore(id: string, content: string): Promise<void> {
  const url = `${VECTOR_ENDPOINT}/vectors/upsert`;
  const payload = { id, content };
  await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${VECTOR_API_KEY}` }
  });
}

/**
 * 1) Clone or pull all repos listed in repos.config.json
 */
export async function updateDocsRepos(): Promise<void> {
  const git = simpleGit();
  for (const repo of reposConfig.repos) {
    const targetPath = path.join(localManualFolder, 'github', repo.name);
    if (!fs.existsSync(targetPath)) {
      console.log(`Cloning ${repo.url} into ${targetPath}...`);
      await git.clone(repo.url, targetPath);
    } else {
      console.log(`Pulling latest changes for ${repo.url} in ${targetPath}...`);
      await git.cwd(targetPath).pull();
    }
  }
}

/**
 * 2) Convert Markdown files to plain text in the entire ManualFolder
 *    This covers all cloned repos plus any subfolders you manually put in "ManualFolder".
 */
export function convertAllMdToTxt(): string[] {
  const convertedFiles: string[] = [];

  const walkDir = (dir: string) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else if (file.toLowerCase().endsWith('.md')) {
        const mdContent = fs.readFileSync(fullPath, 'utf-8');
        const txtContent = mdContent
          .replace(/```[\s\S]*?```/g, '')
          .replace(/[#>*_]/g, '')
          .trim();

        const txtPath = fullPath.replace(/\.md$/i, '.txt');
        fs.writeFileSync(txtPath, txtContent, 'utf-8');
        convertedFiles.push(txtPath);
      }
    }
  };

  walkDir(localManualFolder);
  return convertedFiles;
}

/**
 * 3) Process converted files: only upload missing ones
 */
export async function processAndUploadTxt(): Promise<void> {
  const files = convertAllMdToTxt();

  for (const filePath of files) {
    const id = computeDocumentId(filePath);
    try {
      const exists = await checkInVectorStore(id);
      if (!exists) {
        const content = fs.readFileSync(filePath, 'utf-8');
        console.log(`Uploading new document: ${filePath}`);
        await uploadToVectorStore(id, content);
      } else {
        console.log(`Already in vector store, skipping: ${filePath}`);
      }
    } catch (err) {
      console.error(`Error processing ${filePath}:`, err);
    }
  }
}

/**
 * Main entrypoint if invoked directly
 */
if (require.main === module) {
  (async () => {
    await updateDocsRepos();
    await processAndUploadTxt();
    console.log('Docs update and vector-store sync complete.');
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
