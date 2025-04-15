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
import { askYesNo } from './cliUtils';
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

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

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

async function updateAssistantDocs() {
  const vectorStoreIdPath = path.join(__dirname, '..', 'vectorStoreId.txt');
  const reupload = await askYesNo("Do you want to re-upload files to the vector store? (y/n): ");
  let vectorStoreId: string;
  if (reupload) {
    console.log('Updating docs from GitHub...');
    await updateDocsRepos();
    const mdTxtFiles = convertAllMdToTxt();
    console.log('Converted Markdown files:', mdTxtFiles);
    const manualFolderPath = path.join(__dirname, '..', 'ManualFolder');
    await convertNonTextToTxt(manualFolderPath);
    const allTextFiles = gatherTextFilesWrapper(manualFolderPath);
    console.log('All text files to upload:', allTextFiles);
    const fileIds: string[] = [];
    for (const filePath of allTextFiles) {
      try {
        const uploaded = await uploadFile(filePath);
        fileIds.push(uploaded.id);
        console.log(`Uploaded ${filePath} as file id: ${uploaded.id}`);
      } catch (err) {
        console.error(`Error uploading ${filePath}:`, err);
      }
    }
    try {
      vectorStoreId = await createVectorStore("Nervos Docs Vector Store");
      console.log("Created vector store with ID:", vectorStoreId);
    } catch (err) {
      console.error("Error creating vector store:", err);
      return;
    }
    for (const fileId of fileIds) {
      try {
        await addFileToVectorStore(vectorStoreId, fileId);
        console.log(`Added file id ${fileId} to vector store`);
      } catch (err) {
        console.error(`Error adding file id ${fileId}:`, err);
      }
    }
    fs.writeFileSync(vectorStoreIdPath, vectorStoreId, 'utf-8');
    console.log(`Vector store ID saved to ${vectorStoreIdPath}`);
  } else {
    if (fs.existsSync(vectorStoreIdPath)) {
      vectorStoreId = fs.readFileSync(vectorStoreIdPath, 'utf-8').trim();
      console.log(`Using existing vector store id: ${vectorStoreId}`);
    } else {
      console.log("No existing vector store id found. Proceeding with file upload.");
      return updateAssistantDocs();
    }
  }
  try {
    const assistant = await createOrUpdateAssistantWithVectorStore(vectorStoreId);
    setAssistantId(assistant.id);
    console.log('Assistant updated with ID:', assistant.id);
  } catch (err) {
    console.error('Error creating/updating Assistant:', err);
  }
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
  await updateAssistantDocs();

  // Schedule all active jobs using the assistantRunner helper to send responses to the same channel where the job was created
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

  setInterval(updateAssistantDocs, 60 * 60 * 24000);
});

client.login(DISCORD_BOT_TOKEN);
