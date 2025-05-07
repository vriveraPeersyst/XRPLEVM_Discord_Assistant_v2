// src/index.ts
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  Interaction,
  ChatInputCommandInteraction,
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
import { bullManagerCommand } from './commands/bullManager';
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
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID!;  // ID of the channel where update logs should go

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

let assistantId: string = "";
(globalThis as any).assistantId = assistantId;

const statelessConversations = new Map<string, { role: string; content: string }[]>();

function gatherTextFilesWrapper(rootDir: string): string[] {
  return gatherTextFiles(rootDir);
}

/**
 * Pulls all repos, converts .md → .txt, uploads to OpenAI,
 * rebuilds the vector store, and updates the assistant.
 */
async function updateAssistantDocs(): Promise<{
  newStoreId: string;
  assistantId: string;
  uploadedCount: number;
}> {
  const vectorStoreIdPath = path.join(__dirname, '..', 'vectorStoreId.txt');

  console.log('🔄 [auto] Updating docs from GitHub…');
  await updateDocsRepos();

  // 1) Convert Markdown repos to .txt
  const mdTxtFiles = convertAllMdToTxt();
  console.log('Converted Markdown files:', mdTxtFiles);

  // 2) Convert ManualFolder assets (PDF/images/CSV) to .txt
  const manualFolderPath = path.join(__dirname, '..', 'ManualFolder');
  await convertNonTextToTxt(manualFolderPath);
  const manualTxtFiles = gatherTextFilesWrapper(manualFolderPath);
  console.log('Manual text files:', manualTxtFiles);

  // 3) Combine and upload every .txt
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

  // 4) Create new vector store & add files
  const newStoreId = await createVectorStore("Daily Docs Vector Store");
  console.log(`Created vector store: ${newStoreId}`);
  for (const fid of fileIds) {
    try {
      await addFileToVectorStore(newStoreId, fid);
    } catch (err) {
      console.error(`Failed to add file ${fid} to vector store:`, err);
    }
  }

  // 5) Persist the store ID
  fs.writeFileSync(vectorStoreIdPath, newStoreId, 'utf-8');

  // 6) Re-create / update the assistant
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
  let conversationMessages = [{ role: 'user', content: finalPrompt }];
  try {
    let answer = await runAssistantConversation(getAssistantId(), conversationMessages);
    answer = answer.replace(/【.*?†source】/g, '');
    if (answer.length > 1900) {
      const buffer = Buffer.from(answer, 'utf-8');
      const fileAttachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
      const botReply = await message.reply({
        content: 'The response is too long; please see the attached file:',
        files: [fileAttachment],
      });
      conversationMessages.push({ role: 'assistant', content: answer });
      statelessConversations.set(botReply.id, conversationMessages);
    } else {
      const botReply = await message.reply(answer);
      conversationMessages.push({ role: 'assistant', content: answer });
      statelessConversations.set(botReply.id, conversationMessages);
    }
  } catch (error) {
    console.error('Error running assistant conversation:', error);
    await message.reply('There was an error processing your request. Please try again later.');
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.isThread()) {
    if (message.content && !message.content.trim().startsWith('!')) {
      await handleAutoThreadMessage(message);
      return;
    }
  }

  if (message.reference?.messageId) {
    const originalBotMsgId = message.reference.messageId;
    if (statelessConversations.has(originalBotMsgId)) {
      console.log(`↪️ User is replying to a stateless bot message: ${originalBotMsgId}`);
      const conversation = statelessConversations.get(originalBotMsgId)!;
      const userPrompt = await processInput(message, []);
      if (!userPrompt) {
        console.log('⚠️ No valid input in user reply.');
        return;
      }
      conversation.push({ role: 'user', content: userPrompt });
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
          statelessConversations.delete(originalBotMsgId);
          statelessConversations.set(botReply.id, conversation);
        } else {
          const botReply = await message.reply(answer);
          conversation.push({ role: 'assistant', content: answer });
          statelessConversations.delete(originalBotMsgId);
          statelessConversations.set(botReply.id, conversation);
        }
      } catch (error) {
        console.error('Error running assistant conversation (reply):', error);
        await message.reply('There was an error processing your reply. Please try again later.');
      }
      return;
    }
  }

  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;  
  console.log(`🔹 Processing command: "${command}" from ${message.author.tag}`);
  if (command === 'askbull') {
    await handleStatelessCommand(message, args);
  } else if (command === 'askbullthread') {
    await handleThreadCommand(message, args, false);
  } else if (command === 'askbullprivatethread') {
    await handleThreadCommand(message, args, true);
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const slashInteraction = interaction as ChatInputCommandInteraction;
  if (slashInteraction.commandName === bullManagerCommand.name) {
    const subcommand = slashInteraction.options.getSubcommand();
    if (subcommand === 'update') {
      await slashInteraction.reply({ content: 'Updating Assistant Docs...' });
      try {
        await updateAssistantDocs();
        await slashInteraction.followUp({ content: `Assistant updated with ID: ${getAssistantId()}` });
      } catch (error) {
        await slashInteraction.followUp({ content: 'Error updating Assistant docs.' });
      }
    } else if (subcommand === 'add') {
      try {
        const { addScheduledContentInteractive } = await import('./assistantManager');
        await addScheduledContentInteractive(slashInteraction);
      } catch (error) {
        console.error('Error in addScheduledContentInteractive:', error);
        if (slashInteraction.replied || slashInteraction.deferred) {
          await slashInteraction.followUp({ content: 'Error adding scheduled content.' });
        } else {
          await slashInteraction.reply({ content: 'Error adding scheduled content.' });
        }
      }
    } else if (subcommand === 'toggle') {
      const jobId = slashInteraction.options.getString('id');
      if (!jobId) {
        await slashInteraction.reply({ content: 'Please provide the job ID to toggle.' });
        return;
      }
      const { toggleScheduledContent } = await import('./assistantManager') as unknown as { toggleScheduledContent: (id: string) => Promise<void> };
      await toggleScheduledContent(jobId);
      await slashInteraction.reply({ content: `Toggled job status for job ID: ${jobId}` });
    } else if (subcommand === 'list') {
      const { listScheduledContents } = await import('./scheduler');
      const scheduledList = listScheduledContents();
      if (scheduledList.length === 0) {
        await slashInteraction.reply('No scheduled content found.');
      } else {
        const lines = scheduledList.map(c =>
          `**${c.title}** (ID: \`${c.id}\`) - Status: \`${c.status}\`, Cron: \`${c.cronExpression}\``
        );
        await slashInteraction.reply({ content: lines.join('\n') });
      }
    }
  }
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  // 1) Initial, non-blocking docs update at startup
  updateAssistantDocs().catch(console.error);

  // 2) Schedule a daily refresh at 02:00 UTC, with logging to admin channel
  cron.schedule('0 2 * * *', async () => {
    console.log('🕑 Running daily assistant-docs update…');
    const adminChan = client.channels.cache.get(ADMIN_CHANNEL_ID) as TextChannel | undefined;

    try {
      const { newStoreId, assistantId, uploadedCount } = await updateAssistantDocs();
      const successMsg =
        `✅ Daily docs update succeeded.\n` +
        `• Files uploaded: ${uploadedCount}\n` +
        `• Vector Store ID: ${newStoreId}\n` +
        `• Assistant ID: ${assistantId}`;
      if (adminChan) await adminChan.send(successMsg);
    } catch (err: any) {
      console.error('Daily update failed:', err);
      const errMsg = `❌ Daily docs update failed:\n\`${err.stack || err.message || err}\``;
      if (adminChan) await adminChan.send(errMsg);
    }
  });

  // 3) Schedule all active content jobs exactly as before
  scheduleAllActiveContent(async (content: ScheduledContent) => {
    console.log(`\n🔔 Cron triggered for: ${content.title}`);

    // Build the conversation from the scheduled prompt
    const conversation = [{ role: 'user', content: content.prompt }];

    if (content.channelId) {
      const channel = client.channels.cache.get(content.channelId);
      if (channel && "send" in channel && typeof channel.send === "function") {
        await runAssistantAndSendReply(conversation, channel as TextChannel);
      } else {
        console.warn(`Channel ${content.channelId} not found or not text-based.`);
      }
    } else {
      console.warn(`No channelId stored for scheduled job "${content.title}".`);
      try {
        let answer = await runAssistantConversation(getAssistantId(), conversation);
        answer = answer.replace(/【.*?†source】/g, '');
        console.log(`Scheduled job "${content.title}" assistant reply:\n${answer}`);
      } catch (error) {
        console.error('Error running scheduled job assistant conversation:', error);
      }
    }
  });
});

client.login(DISCORD_BOT_TOKEN);
