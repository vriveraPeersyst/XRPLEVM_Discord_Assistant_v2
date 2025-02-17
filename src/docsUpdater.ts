// src/docsUpdater.ts
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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

/**
 * 1) Clone or pull all repos listed in repos.config.json
 */
export async function updateDocsRepos(): Promise<void> {
  const git = simpleGit();
  
  for (const repo of reposConfig.repos) {
    // e.g. name="nervos-docs", url="https://github.com/nervosnetwork/docs"
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
        // Read .md content
        const mdContent = fs.readFileSync(fullPath, 'utf-8');
        // Basic cleanup or advanced MD->text conversion
        const txtContent = mdContent
          .replace(/```[\s\S]*?```/g, '') // remove code blocks
          .replace(/[#>*_]/g, '')         // remove some MD formatting chars
          .trim();

        // Save side-by-side as .txt
        const txtPath = fullPath.replace(/\.md$/, '.txt');
        fs.writeFileSync(txtPath, txtContent, 'utf-8');
        convertedFiles.push(txtPath);
      }
    }
  };

  walkDir(localManualFolder);
  return convertedFiles;
}
