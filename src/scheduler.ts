// src/scheduler.ts
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

export interface ScheduledContent {
  id: string;
  title: string;
  status: 'active' | 'paused';
  cronExpression: string;
  startTime: string; // ISO string in UTC
  prompt: string;
  generalInfo: string;
  context: string;
  fileIteration: boolean;
  folderPath?: string; // if file iteration is on, the folder to cycle through
  channelId?: string;  // NEW: stores the channel from which this job was scheduled
}

const SCHEDULED_CONTENT_FILE = path.join(__dirname, '..', 'scheduledContent.json');
let scheduledContents: ScheduledContent[] = [];

/**
 * Load scheduled content definitions from persistent storage.
 */
export function loadScheduledContents() {
  if (fs.existsSync(SCHEDULED_CONTENT_FILE)) {
    const data = fs.readFileSync(SCHEDULED_CONTENT_FILE, 'utf-8');
    scheduledContents = JSON.parse(data);
  } else {
    scheduledContents = [];
  }
}

/**
 * Save scheduled content definitions.
 */
export function saveScheduledContents() {
  fs.writeFileSync(SCHEDULED_CONTENT_FILE, JSON.stringify(scheduledContents, null, 2));
}

/**
 * Add a new scheduled content job.
 */
export function addScheduledContent(content: ScheduledContent): void {
  scheduledContents.push(content);
  saveScheduledContents();
}

/**
 * List all scheduled content jobs.
 */
export function listScheduledContents(): ScheduledContent[] {
  return scheduledContents;
}

/**
 * Update the status of a scheduled job.
 */
export function updateScheduledContentStatus(id: string, status: 'active' | 'paused'): boolean {
  const content = scheduledContents.find(c => c.id === id);
  if (content) {
    content.status = status;
    saveScheduledContents();
    return true;
  }
  return false;
}

/**
 * Map to hold active cron tasks.
 */
const cronTasks = new Map<string, cron.ScheduledTask>();

/**
 * Schedule all active content jobs.
 * The onTrigger callback will be invoked when a job fires.
 */
export function scheduleAllActiveContent(onTrigger: (content: ScheduledContent) => void) {
  // Cancel any existing tasks.
  cronTasks.forEach(task => task.stop());
  cronTasks.clear();
  
  for (const content of scheduledContents) {
    if (content.status === 'active') {
      const task = cron.schedule(content.cronExpression, () => {
        onTrigger(content);
      });
      cronTasks.set(content.id, task);
      console.log(`Scheduled task for: ${content.title}`);
    }
  }
}

/**
 * Cancel a scheduled task.
 */
export function cancelScheduledTask(id: string) {
  const task = cronTasks.get(id);
  if (task) {
    task.stop();
    cronTasks.delete(id);
  }
}
