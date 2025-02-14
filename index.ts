// index.ts
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  Attachment,
  ThreadChannel,
  ChannelType,
  MessageType
} from 'discord.js';
import { updateDocsRepo, convertMdToTxt } from './docsUpdater';
import {
  uploadFile,
  createOrUpdateAssistantWithVectorStore,
  runAssistantConversation,
  createVectorStore,
  addFileToVectorStore
} from './assistantClient';
import * as dotenv from 'dotenv';
import axios from 'axios';
import Tesseract from 'tesseract.js';
import pdf from 'pdf-parse';

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

// Create a Discord client with necessary intents (including MessageContent).
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Required to read messages
    GatewayIntentBits.GuildMessageReactions,
  ]
});

// Global variable to hold your Assistant's ID.
let assistantId: string;

/**
 * Extract text from a document attachment (.txt, .md, .pdf, .csv)
 */
async function extractTextFromDocAttachment(attachment: Attachment): Promise<string> {
  const fileName = attachment.name?.toLowerCase() || "";
  const isPDF = fileName.endsWith('.pdf');
  try {
    const response = await axios.get(attachment.url, { responseType: isPDF ? 'arraybuffer' : 'text' });
    if (isPDF) {
      const dataBuffer = Buffer.from(response.data);
      const pdfData = await pdf(dataBuffer);
      return pdfData.text;
    } else if (
      fileName.endsWith('.txt') ||
      fileName.endsWith('.md') ||
      fileName.endsWith('.csv')
    ) {
      return response.data;
    } else {
      console.error('Unsupported document file type:', fileName);
      return '';
    }
  } catch (error) {
    console.error(`Error processing ${fileName}:`, error);
    return '';
  }
}

/**
 * Update docs from GitHub and create/update the Assistant using a vector store.
 */
async function updateAssistantDocs() {
  console.log('Updating docs from GitHub...');
  await updateDocsRepo();
  const txtFiles = convertMdToTxt();
  console.log('Converted files:', txtFiles);

  // Upload each file and gather their file IDs.
  const fileIds: string[] = [];
  for (const filePath of txtFiles) {
    try {
      const uploaded = await uploadFile(filePath);
      fileIds.push(uploaded.id);
      console.log(`Uploaded ${filePath} as file id: ${uploaded.id}`);
    } catch (err) {
      console.error(`Error uploading ${filePath}:`, err);
    }
  }

  // Create a vector store for the files.
  let vectorStoreId: string;
  try {
    vectorStoreId = await createVectorStore("XRPL Docs Vector Store");
    console.log("Created vector store with ID:", vectorStoreId);
  } catch (err) {
    console.error("Error creating vector store:", err);
    return;
  }

  // Add each file to the vector store.
  for (const fileId of fileIds) {
    try {
      await addFileToVectorStore(vectorStoreId, fileId);
      console.log(`Added file id ${fileId} to vector store`);
    } catch (err) {
      console.error(`Error adding file id ${fileId}:`, err);
    }
  }

  // Create or update your Assistant using the vector store.
  try {
    const assistant = await createOrUpdateAssistantWithVectorStore(vectorStoreId);
    assistantId = assistant.id;
    console.log('Assistant updated with ID:', assistantId);
  } catch (err) {
    console.error('Error creating/updating Assistant:', err);
  }
}

/**
 * Process user input (message content + attachments).
 */
async function processInput(message: any, args: string[]): Promise<string> {
  let promptText = args.join(' ');
  let attachmentText = '';

  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      const fileName = attachment.name?.toLowerCase() || '';
      const supportedDocExtensions = ['.txt', '.md', '.pdf', '.csv'];
      const supportedImageExtensions = ['.png', '.jpg', '.jpeg', '.gif'];

      if (supportedDocExtensions.some(ext => fileName.endsWith(ext))) {
        attachmentText += '\n' + (await extractTextFromDocAttachment(attachment));
      } else if (supportedImageExtensions.some(ext => fileName.endsWith(ext))) {
        try {
          const imageResponse = await axios.get(attachment.url, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');
          const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
          attachmentText += '\n' + text;
        } catch (error) {
          console.error('Error processing image attachment for OCR:', error);
        }
      } else {
        console.error('Unsupported attachment file type:', fileName);
      }
    }
  }

  return (promptText + '\n' + attachmentText).trim();
}

/**
 * Stateless command: !xrplevm
 * Single-message conversation (no thread).
 */
async function handleStatelessCommand(message: any, args: string[]) {
  const finalPrompt = await processInput(message, args);
  if (!finalPrompt) {
    await message.reply('Please provide some text or attach a file/image with text.');
    return;
  }
  // Single-message conversation.
  const conversationMessages = [{ role: 'user', content: finalPrompt }];
  try {
    let answer = await runAssistantConversation(assistantId, conversationMessages);
    // Remove any source annotations.
    answer = answer.replace(/【.*?†source】/g, '');
    if (answer.length > 1900) {
      const buffer = Buffer.from(answer, 'utf-8');
      const fileAttachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
      await message.reply({
        content: 'The response is too long; please see the attached file:',
        files: [fileAttachment]
      });
    } else {
      await message.reply(answer);
    }
  } catch (error) {
    console.error('Error running assistant conversation:', error);
    await message.reply('There was an error processing your request. Please try again later.');
  }
}

/**
 * Thread-based commands (public or private).
 * Creates or reuses a thread and uses conversation history.
 */
async function handleThreadCommand(message: any, args: string[], isPrivate: boolean) {
  let thread: ThreadChannel;
  if (message.channel.isThread()) {
    thread = message.channel as ThreadChannel;
  } else {
    try {
      const threadOptions: any = {
        name: isPrivate
          ? `XRPL EVM Private Conversation`
          : `XRPL EVM Conversation`,
        autoArchiveDuration: 60,
        reason: 'Conversation with XRPL EVM assistant',
      };
      if (isPrivate) {
        threadOptions.type = ChannelType.GuildPrivateThread;
      }
      thread = await message.startThread(threadOptions);
    } catch (error) {
      console.error('Error creating thread:', error);
      await message.reply('Could not create a thread for the conversation.');
      return;
    }
  }

  const finalPrompt = await processInput(message, args);
  if (!finalPrompt) {
    await thread.send('Please provide some text or attach a file/image with text.');
    return;
  }

  await handleOngoingThreadMessage(thread, finalPrompt, message);
}

/**
 * Handle ongoing conversation in a thread, with "branching" if the user replies to an older message.
 * If user replies to an older message, ignore all messages after that one in the timeline.
 */
async function handleOngoingThreadMessage(
  thread: ThreadChannel,
  newUserPrompt: string,
  originalMessage: any
) {
  let conversationMessages: { role: string; content: string }[] = [];

  // If the user is replying to an older message, we want to ignore any messages posted after that.
  let cutoffTime = Infinity;
  const replyId = originalMessage.reference?.messageId;
  if (replyId) {
    try {
      const repliedTo = await thread.messages.fetch(replyId);
      cutoffTime = repliedTo.createdTimestamp;
    } catch (error) {
      console.warn('Could not fetch replied-to message. Proceeding without cutoff.');
    }
  }

  try {
    const fetchedMessages = await thread.messages.fetch({ limit: 100 });
    const sortedMessages = Array.from(fetchedMessages.values()).sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    conversationMessages = sortedMessages
      .filter((m) => {
        // 1) If there's a cutoffTime, ignore messages that come after that
        if (m.createdTimestamp > cutoffTime) return false;

        // 2) Allow both normal text messages AND replies
        //    (MessageType.Default = 0, MessageType.Reply = 19, etc.)
        if (![MessageType.Default, MessageType.Reply].includes(m.type)) return false;

        // 3) Exclude empty or whitespace-only messages
        if (!m.content || !m.content.trim()) return false;

        return true;
      })
      .map((m) => {
        const role = m.author.bot ? 'assistant' : 'user';
        return { role, content: m.content.trim() };
      });
  } catch (error) {
    console.error('Error fetching conversation history:', error);
  }

  // Always add the user's latest prompt as the final message
  conversationMessages.push({ role: 'user', content: newUserPrompt });

  try {
    let answer = await runAssistantConversation(assistantId, conversationMessages);
    answer = answer.replace(/【.*?†source】/g, '');
    if (answer.length > 1900) {
      const buffer = Buffer.from(answer, 'utf-8');
      const fileAttachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
      await thread.send({
        content: 'The response is too long; please see the attached file:',
        files: [fileAttachment],
      });
    } else {
      await thread.send(answer);
    }
  } catch (error) {
    console.error('Error running assistant conversation:', error);
    await thread.send('There was an error processing your request. Please try again later.');
  }
}

/**
 * Handle automatic replies when users type in an existing XRPL EVM conversation thread,
 * without requiring a command prefix.
 */
async function handleAutoThreadMessage(message: any) {
  const newUserPrompt = await processInput(message, []);
  if (!newUserPrompt) return; // Nothing to process
  const thread = message.channel as ThreadChannel;
  await handleOngoingThreadMessage(thread, newUserPrompt, message);
}

// Listen for messages to handle commands or auto thread replies.
client.on('messageCreate', async (message) => {
  // Ignore messages from bots (including self).
  if (message.author.bot) return;

  // Ensure message.channel is valid
  if (!message.channel) {
    console.warn(`⚠️ Message received but channel is undefined.`);
    return;
  }

  // Check if it's inside a thread
  if (message.channel.isThread()) {
    const thread = message.channel as ThreadChannel;
    console.log(`📌 Received message inside thread: "${thread.name}" from ${message.author.tag}`);

    // If the thread name matches our XRPL EVM conversation format
    if (
      thread.name.includes('XRPL EVM Conversation') ||
      thread.name.includes('XRPL EVM Private Conversation')
    ) {
      // If the message does NOT start with "!", handle it automatically
      if (!message.content.trim().startsWith('!')) {
        console.log(`📝 Auto-handling message in thread: ${thread.name}`);
        await handleAutoThreadMessage(message);
        return;
      }
    }
  } else {
  }

  // 2) Otherwise, parse prefix commands
  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (!command) return;

  console.log(`🔹 Processing command: "${command}" from ${message.author.tag}`);

  if (command === 'xrplevm') {
    // Stateless command
    await handleStatelessCommand(message, args);
  } else if (command === 'xrplevmthread') {
    // Public thread-based conversation
    await handleThreadCommand(message, args, false);
  } else if (command === 'xrplevmprivatethread') {
    // Private thread-based conversation
    await handleThreadCommand(message, args, true);
  }
});


// On startup, log in and update Assistant docs.
client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await updateAssistantDocs();
  // Optionally update docs at regular intervals (e.g., daily)
  setInterval(updateAssistantDocs, 60 * 60 * 24000);
});

client.login(DISCORD_BOT_TOKEN);
