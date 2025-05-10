// src/index.ts
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  TextChannel,
  ThreadChannel,
} from 'discord.js';
import cron from 'node-cron';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import { updateDocsRepos, convertAllMdToTxt } from './docsUpdater';
import { convertNonTextToTxt, gatherTextFiles } from './fileProcessor';
import {
  uploadFile,
  createVectorStore,
  addFileToVectorStore,
  createOrUpdateAssistantWithVectorStore,
  runAssistantConversation,
} from './assistantClient';
import { processInput } from './messageProcessor';
import {
  handleThreadCommand,
  handleAutoThreadMessage,
} from './threadHandler';
import { getAssistantId, setAssistantId } from './assistantGlobals';

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID!;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// In-memory store for stateless (one-off) conversations
const statelessConversations = new Map<string, { role: string; content: string }[]>();

/**
 * Pull down all repos, convert docs → .txt, upload, rebuild vector store & assistant.
 */
async function updateAssistantDocs(): Promise<{
  newStoreId: string;
  assistantId: string;
  uploadedCount: number;
}> {
  const vectorStoreIdPath = path.join(__dirname, '..', 'vectorStoreId.txt');

  console.log('🔄 [auto] Updating docs from GitHub…');
  await updateDocsRepos();

  // 1) Markdown → .txt
  const mdTxtFiles = convertAllMdToTxt();
  console.log('Converted Markdown files:', mdTxtFiles);

  // 2) Non-text (PDF/images/CSV) → .txt
  const manualFolder = path.join(__dirname, '..', 'ManualFolder');
  await convertNonTextToTxt(manualFolder);
  const manualTxtFiles = gatherTextFiles(manualFolder);
  console.log('Manual text files:', manualTxtFiles);

  // 3) Upload every .txt
  const allFiles = [...mdTxtFiles, ...manualTxtFiles];
  const fileIds: string[] = [];
  for (const fp of allFiles) {
    try {
      const { id } = await uploadFile(fp);
      fileIds.push(id);
      console.log(`  • uploaded ${fp} → ${id}`);
    } catch (err) {
      console.error(`Failed to upload ${fp}:`, err);
    }
  }

  // 4) Create new vector store & add files
  const newStoreId = await createVectorStore('Daily Docs Vector Store');
  console.log(`Created vector store: ${newStoreId}`);
  for (const fid of fileIds) {
    await addFileToVectorStore(newStoreId, fid).catch(err =>
      console.error(`Failed to add ${fid}:`, err)
    );
  }

  // 5) Persist the store ID
  fs.writeFileSync(vectorStoreIdPath, newStoreId, 'utf-8');

  // 6) Create/update the assistant
  const assistant = await createOrUpdateAssistantWithVectorStore(newStoreId);
  setAssistantId(assistant.id);
  console.log(`✅ Assistant updated (id=${assistant.id})`);

  return { newStoreId, assistantId: assistant.id, uploadedCount: fileIds.length };
}

/**
 * Handle a one-off, stateless "!xrplevm" command.
 */
async function handleStatelessCommand(message: any, args: string[]) {
  // Guard: assistant must be ready
  if (!getAssistantId()) {
    await message.reply(
      '🚧 Assistant is still loading its docs. Please wait a moment and try again.'
    );
    return;
  }

  const finalPrompt = await processInput(message, args);
  if (!finalPrompt) {
    await message.reply('Please provide some text or attach a file/image.');
    return;
  }

  const convo = [{ role: 'user', content: finalPrompt }];
  try {
    let answer = await runAssistantConversation(getAssistantId(), convo);
    answer = answer.replace(/【.*?†source】/g, '');
    if (answer.length > 1900) {
      const buf = Buffer.from(answer, 'utf-8');
      const att = new AttachmentBuilder(buf, { name: 'response.txt' });
      const reply = await message.reply({ content: 'Too long, see attached:', files: [att] });
      convo.push({ role: 'assistant', content: answer });
      statelessConversations.set(reply.id, convo);
    } else {
      const reply = await message.reply(answer);
      convo.push({ role: 'assistant', content: answer });
      statelessConversations.set(reply.id, convo);
    }
  } catch (err) {
    console.error('Error running assistant conversation:', err);
    await message.reply('❌ Error processing your request. Please try again later.');
  }
}

client.on('messageCreate', async message => {
  // 1) Ignore bots
  if (message.author.bot) return;

  // 2) Stateless-reply chaining
  if (message.reference?.messageId) {
    const orig = message.reference.messageId;
    if (statelessConversations.has(orig)) {
      console.log(`↪️ Reply to stateless message: ${orig}`);
      const convo = statelessConversations.get(orig)!;
      const userText = await processInput(message, []);
      if (!userText) return;
      convo.push({ role: 'user', content: userText });

      try {
        let answer = await runAssistantConversation(getAssistantId(), convo);
        answer = answer.replace(/【.*?†source】/g, '');
        if (answer.length > 1900) {
          const buf = Buffer.from(answer, 'utf-8');
          const att = new AttachmentBuilder(buf, { name: 'response.txt' });
          const botReply = await message.reply({ content: 'Too long, see attached:', files: [att] });
          convo.push({ role: 'assistant', content: answer });
          statelessConversations.delete(orig);
          statelessConversations.set(botReply.id, convo);
        } else {
          const botReply = await message.reply(answer);
          convo.push({ role: 'assistant', content: answer });
          statelessConversations.delete(orig);
          statelessConversations.set(botReply.id, convo);
        }
      } catch (err) {
        console.error('Error in reply convo:', err);
        await message.reply('❌ Error processing your reply.');
      }
      return;
    }
  }

  // 3) Auto‐handle messages inside an XRPLEVM thread
  if (message.channel.isThread()) {
    const thread = message.channel as ThreadChannel;
    if (
      thread.name.includes('xrplevm Conversation') ||
      thread.name.includes('xrplevm Private Conversation')
    ) {
      if (!message.content.trim().startsWith('!')) {
        console.log(`📝 Auto‐handling thread: ${thread.name}`);
        await handleAutoThreadMessage(message);
        return;
      }
    }
  }

  // 4) Prefix commands
  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;
  const parts = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = parts.shift()!.toLowerCase();

  console.log(`🔹 Command "${cmd}" from ${message.author.tag}`);
  if (cmd === 'xrplevm') {
    await handleStatelessCommand(message, parts);
  } else if (cmd === 'xrplevmthread') {
    await handleThreadCommand(message, parts, false);
  } else if (cmd === 'xrplevmprivatethread') {
    await handleThreadCommand(message, parts, true);
  }
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  // 1) Initial docs load
  await updateAssistantDocs();
  console.log('✅ Initial docs loaded, assistant is ready.');

  // 2) Daily 02:00 UTC refresh & admin‐log
  cron.schedule('0 2 * * *', async () => {
    console.log('🕑 Daily docs update…');
    const admin = client.channels.cache.get(ADMIN_CHANNEL_ID) as TextChannel | undefined;
    try {
      const { newStoreId, assistantId, uploadedCount } = await updateAssistantDocs();
      const msg =
        `✅ Docs update succeeded:\n` +
        `• Files: ${uploadedCount}\n` +
        `• VectorStore: ${newStoreId}\n` +
        `• Assistant: ${assistantId}`;
      if (admin) await admin.send(msg);
    } catch (err: any) {
      console.error('Daily update failed:', err);
      if (admin) await admin.send(`❌ Daily update error:\n\`${err.message}\``);
    }
  });
});

client.login(DISCORD_BOT_TOKEN);
