// src/index.ts
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  TextChannel
} from 'discord.js';
import { updateDocsRepos, convertAllMdToTxt } from './docsUpdater';
import { convertNonTextToTxt, gatherTextFiles } from './fileProcessor';
import {
  uploadFile,
  createOrUpdateAssistantWithVectorStore,
  runAssistantConversation,
  createVectorStore,
  addFileToVectorStore
} from './assistantClient';
import { processInput } from './messageProcessor';
import { handleThreadCommand, handleAutoThreadMessage } from './threadHandler';
import { getAssistantId, setAssistantId } from './assistantGlobals';
import { runAssistantAndSendReply } from './assistantRunner';
import {
  loadScheduledContents,
  scheduleAllActiveContent,
  ScheduledContent
} from './scheduler';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID!;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

// In-memory mapping for replies
const statelessConversations = new Map<string, { role: string; content: string }[]>();

function gatherTextFilesWrapper(rootDir: string): string[] {
  return gatherTextFiles(rootDir);
}

/**
 * Rebuilds all docs → txt → OpenAI files → vector store → assistant.
 */
async function updateAssistantDocs(): Promise<{
  newStoreId: string;
  assistantId: string;
  uploadedCount: number;
}> {
  const vectorStoreIdPath = path.join(__dirname, '..', 'vectorStoreId.txt');
  console.log('🔄 [auto] Updating docs from GitHub…');

  await updateDocsRepos();
  const mdTxtFiles = convertAllMdToTxt();
  console.log('Converted Markdown files:', mdTxtFiles);

  const manualFolderPath = path.join(__dirname, '..', 'ManualFolder');
  await convertNonTextToTxt(manualFolderPath);
  const manualTxtFiles = gatherTextFilesWrapper(manualFolderPath);
  console.log('Manual text files:', manualTxtFiles);

  const allTextFiles = [...mdTxtFiles, ...manualTxtFiles];
  const fileIds: string[] = [];
  for (const filePath of allTextFiles) {
    try {
      const { id } = await uploadFile(filePath);
      fileIds.push(id);
      console.log(`  • uploaded ${filePath} → ${id}`);
    } catch (err) {
      console.error(`Failed to upload ${filePath}:`, err);
    }
  }

  const newStoreId = await createVectorStore('Daily Docs Vector Store');
  console.log(`Created vector store: ${newStoreId}`);
  for (const fid of fileIds) {
    try {
      await addFileToVectorStore(newStoreId, fid);
    } catch (err) {
      console.error(`Failed to add file ${fid}:`, err);
    }
  }

  fs.writeFileSync(vectorStoreIdPath, newStoreId, 'utf-8');

  const assistant = await createOrUpdateAssistantWithVectorStore(newStoreId);
  setAssistantId(assistant.id);
  console.log(`✅ Assistant updated (id=${assistant.id})`);

  return {
    newStoreId,
    assistantId: assistant.id,
    uploadedCount: fileIds.length
  };
}

async function handleStatelessCommand(message: any, args: string[]): Promise<void> {
  const finalPrompt = await processInput(message, args);
  if (!finalPrompt) {
    await message.reply('Please provide some text or attach a file/image with text.');
    return;
  }

  const conversation = [{ role: 'user', content: finalPrompt }];
  try {
    let answer = await runAssistantConversation(getAssistantId(), conversation);
    answer = answer.replace(/【.*?†source】/g, '');

    if (answer.length > 1900) {
      const buffer = Buffer.from(answer, 'utf-8');
      const fileAttachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
      const botReply = await message.reply({
        content: 'The response is too long; please see the attached file:',
        files: [fileAttachment],
      });
      conversation.push({ role: 'assistant', content: answer });
      statelessConversations.set(botReply.id, conversation);
    } else {
      const botReply = await message.reply(answer);
      conversation.push({ role: 'assistant', content: answer });
      statelessConversations.set(botReply.id, conversation);
    }
  } catch (error) {
    console.error('Error running assistant conversation:', error);
    await message.reply('There was an error processing your request. Please try again later.');
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Thread-only auto-reply
  if (message.channel.isThread() && message.content && !message.content.trim().startsWith('!')) {
    await handleAutoThreadMessage(message);
    return;
  }

  // Reply-to-bot logic for stateless follow-ups
  if (message.reference?.messageId) {
    const orig = message.reference.messageId;
    if (statelessConversations.has(orig)) {
      const convo = statelessConversations.get(orig)!;
      const userPrompt = await processInput(message, []);
      if (!userPrompt) return;
      convo.push({ role: 'user', content: userPrompt });

      try {
        let answer = await runAssistantConversation(getAssistantId(), convo);
        answer = answer.replace(/【.*?†source】/g, '');

        if (answer.length > 1900) {
          const buffer = Buffer.from(answer, 'utf-8');
          const fileAttachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
          const botReply = await message.reply({
            content: 'The response is too long; please see the attached file:',
            files: [fileAttachment],
          });
          convo.push({ role: 'assistant', content: answer });
          statelessConversations.delete(orig);
          statelessConversations.set(botReply.id, convo);
        } else {
          const botReply = await message.reply(answer);
          convo.push({ role: 'assistant', content: answer });
          statelessConversations.delete(orig);
          statelessConversations.set(botReply.id, convo);
        }
      } catch (error) {
        console.error('Error on follow-up:', error);
        await message.reply('There was an error processing your follow-up. Please try again later.');
      }
      return;
    }
  }

  // Only !-prefix commands now
  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  if (!cmd) return;

  if (cmd === 'xrplevm') {
    await handleStatelessCommand(message, args);
  } else if (cmd === 'xrplevmthread') {
    await handleThreadCommand(message, args, false);
  } else if (cmd === 'xrplevmprivatethread') {
    await handleThreadCommand(message, args, true);
  }
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  // initial docs update
  updateAssistantDocs().catch(console.error);

  // daily docs cron @ 02:00 UTC, with admin logging
  cron.schedule('0 2 * * *', async () => {
    console.log('🕑 Running daily assistant-docs update…');
    const adminChan = client.channels.cache.get(ADMIN_CHANNEL_ID) as TextChannel | undefined;
    try {
      const { newStoreId, assistantId, uploadedCount } = await updateAssistantDocs();
      const msg =
        `✅ Daily docs update succeeded.\n` +
        `• Files uploaded: ${uploadedCount}\n` +
        `• Vector Store ID: ${newStoreId}\n` +
        `• Assistant ID: ${assistantId}`;
      if (adminChan) await adminChan.send(msg);
    } catch (err: any) {
      console.error('Daily update failed:', err);
      const errMsg = `❌ Daily docs update failed:\n\`${err.stack || err.message || err}\``;
      if (adminChan) await adminChan.send(errMsg);
    }
  });

  // scheduled-content jobs (defined in scheduledContent.json)
  scheduleAllActiveContent(async (content: ScheduledContent) => {
    console.log(`🔔 Cron triggered for: ${content.title}`);
    const conv = [{ role: 'user', content: content.prompt }];
    if (content.channelId) {
      const ch = client.channels.cache.get(content.channelId);
      if (ch && 'send' in ch) {
        await runAssistantAndSendReply(conv, ch as TextChannel);
      }
    }
  });
});

client.login(DISCORD_BOT_TOKEN);