// docsUpdater.ts
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const repoUrl = process.env.GITHUB_REPO || '';
const localPath = process.env.DOCS_LOCAL_PATH || './docs';

console.log('Repo URL:', repoUrl);
console.log('Local Path:', localPath);

export async function updateDocsRepo(): Promise<void> {
  const git = simpleGit();

  // If the repo already exists locally, pull the latest changes.
  if (fs.existsSync(localPath)) {
    const repo = simpleGit(localPath);
    console.log('Pulling latest changes...');
    await repo.fetch();
    await repo.pull();
  } else {
    console.log('Cloning repository...');
    await git.clone(repoUrl, localPath);
  }

  // Optionally: retrieve the latest tag using GitHub API.
  try {
    const tagsRes = await axios.get(
      `https://api.github.com/repos/ripple/docs.xrplevm.org/tags`,
      { headers: { Authorization: '' } } // overrides any global default
    );
  
    if (Array.isArray(tagsRes.data) && tagsRes.data.length > 0) {
      const latestTag = tagsRes.data[0].name;
      console.log(`Latest tag found: ${latestTag}`);
  
      // Check out the latest tag locally
      const repo = simpleGit(localPath);
      await repo.checkout(latestTag);
    } else {
      console.log('No tags found, using the current branch.');
    }
  } catch (err) {
    console.error('Error fetching latest tag, using current branch:', err);
  }
  
}

export function convertMdToTxt(): string[] {
  const txtFiles: string[] = [];

  // Recursively find all .md files in the localPath
  function processDir(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        processDir(fullPath);
      } else if (file.endsWith('.md')) {
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Basic conversion: remove Markdown syntax or simply keep content
        // (You can improve this conversion as needed)
        const plainText = content.replace(/[#_*`~>+-]/g, '');
        
        // Write a .txt version next to the .md file or in a separate folder
        const txtFilePath = fullPath.replace(/\.md$/, '.txt');
        fs.writeFileSync(txtFilePath, plainText, 'utf-8');
        txtFiles.push(txtFilePath);
      }
    }
  }

  processDir(localPath);
  return txtFiles;
}
