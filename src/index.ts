// src/index.ts
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  Attachment,
  ThreadChannel,
  ChannelType,
  MessageType
} from 'discord.js';
import { updateDocsRepos, convertAllMdToTxt } from './docsUpdater';
import { convertNonTextToTxt } from './convertNonTextToTxt';
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
import path from 'path';
import fs from 'fs';

// Add at the top of your file (if not already imported)
import readline from 'readline';

// Helper to ask a yes/no question.
async function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

// Create a Discord client with necessary intents.
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

// Stores conversation arrays keyed by the bot's own message ID.
const statelessConversations = new Map<string, { role: string; content: string }[]>();

/**
 * Recursively gather all .txt files in the given root directory.
 */
function gatherTextFiles(rootDir: string): string[] {
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

/**
 * Update docs from GitHub and from local ManualFolder.
 *
 * Steps:
 * 1. Update/pull all GitHub repos (via updateDocsRepos).
 * 2. Convert all Markdown files to .txt.
 * 3. Convert non‑text files (PDFs, CSVs, images) to .txt.
 * 4. Gather all .txt files from ManualFolder.
 * 5. Upload each .txt file and add them to a vector store.
 * 6. Create or update the Assistant with that vector store.
 */
// Modified updateAssistantDocs function
async function updateAssistantDocs() {
  // Path to save the vector store id for future runs.
  const vectorStoreIdPath = path.join(__dirname, '..', 'vectorStoreId.txt');

  // Ask if the user wants to re-upload files to the vector store.
  const reupload = await askYesNo("Do you want to re-upload files to the vector store? (y/n): ");
  let vectorStoreId: string;

  if (reupload) {
    console.log('Updating docs from GitHub...');
    await updateDocsRepos();

    // Convert Markdown files.
    const mdTxtFiles = convertAllMdToTxt();
    console.log('Converted Markdown files:', mdTxtFiles);

    // Convert non‑text files (PDFs, CSVs, images) to .txt.
    const manualFolderPath = path.join(__dirname, '..', 'ManualFolder');
    const nonTextTxtFiles = await convertNonTextToTxt(manualFolderPath);
    console.log('Converted non‑text files:', nonTextTxtFiles);

    // Gather all .txt files.
    const allTextFiles = gatherTextFiles(manualFolderPath);
    console.log('All text files to upload:', allTextFiles);

    // Upload each file and collect their file IDs.
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

    // Create a new vector store.
    try {
      vectorStoreId = await createVectorStore("Nervos Docs Vector Store");
      console.log("Created vector store with ID:", vectorStoreId);
    } catch (err) {
      console.error("Error creating vector store:", err);
      return;
    }

    // Add each uploaded file to the vector store.
    for (const fileId of fileIds) {
      try {
        await addFileToVectorStore(vectorStoreId, fileId);
        console.log(`Added file id ${fileId} to vector store`);
      } catch (err) {
        console.error(`Error adding file id ${fileId}:`, err);
      }
    }

    // Save the vector store id for future runs.
    fs.writeFileSync(vectorStoreIdPath, vectorStoreId, 'utf-8');
    console.log(`Vector store ID saved to ${vectorStoreIdPath}`);
  } else {
    // Use an existing vector store id if available.
    if (fs.existsSync(vectorStoreIdPath)) {
      vectorStoreId = fs.readFileSync(vectorStoreIdPath, 'utf-8').trim();
      console.log(`Using existing vector store id: ${vectorStoreId}`);
    } else {
      console.log("No existing vector store id found. Proceeding with file upload.");
      return updateAssistantDocs();
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
 * Extract text from a document attachment (.txt, .md, .pdf, .csv).
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
 * Process user input (message content + attachments).
 */
async function processInput(message: any, args: string[]): Promise<string> {
  console.log(`📝 Processing message from: ${message.author.tag}`);
  console.log(`📌 Raw Message Content: "${message.content}"`);
  console.log(`📎 Attachments count: ${message.attachments.size}`);

  let promptText = args.length > 0 ? args.join(' ') : message.content.trim();
  console.log(`📖 After Args Join: "${promptText}"`);

  let attachmentText = '';

  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      const fileName = attachment.name?.toLowerCase() || '';
      const supportedDocExtensions = ['.txt', '.md', '.pdf', '.csv'];
      const supportedImageExtensions = ['.png', '.jpg', '.jpeg', '.gif'];

      if (supportedDocExtensions.some(ext => fileName.endsWith(ext))) {
        console.log(`📖 Processing document: ${fileName}`);
        attachmentText += '\n' + (await extractTextFromDocAttachment(attachment));
      } else if (supportedImageExtensions.some(ext => fileName.endsWith(ext))) {
        console.log(`🖼️ Processing image: ${fileName}`);
        try {
          const imageResponse = await axios.get(attachment.url, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');
          const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
          attachmentText += '\n' + text;
        } catch (error) {
          console.error('Error processing image attachment for OCR:', error);
        }
      } else {
        console.error(`⚠️ Unsupported attachment file type: ${fileName}`);
      }
    }
  }

  const finalInput = (promptText + '\n' + attachmentText).trim();
  console.log(`🔎 Final processed input: "${finalInput}"`);
  return finalInput;
}

/**
 * Stateless command: !askbull
 * Single-message conversation (no thread).
 */
async function handleStatelessCommand(message: any, args: string[]) {
  const finalPrompt = await processInput(message, args);
  if (!finalPrompt) {
    await message.reply('Please provide some text or attach a file/image with text.');
    return;
  }
  let conversationMessages = [{ role: 'user', content: finalPrompt }];
  try {
    let answer = await runAssistantConversation(assistantId, conversationMessages);
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

/**
 * Thread-based commands (public or private).
 */
async function handleThreadCommand(message: any, args: string[], isPrivate: boolean) {
  let thread: ThreadChannel;
  if (message.channel.isThread()) {
    thread = message.channel as ThreadChannel;
  } else {
    try {
      const threadOptions: any = {
        name: isPrivate ? `askBull Private Conversation` : `askBull Conversation`,
        autoArchiveDuration: 60,
        reason: 'Conversation with CKBull assistant',
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
 * Gather full conversation in the thread (including attachments) up to an optional cutoff.
 */
async function handleOngoingThreadMessage(
  thread: ThreadChannel,
  newUserPrompt: string,
  originalMessage: any
) {
  console.log(`🔄 Entered handleOngoingThreadMessage for thread: ${thread.name}`);
  let cutoffTime = Infinity;
  const replyId = originalMessage.reference?.messageId;
  if (replyId) {
    try {
      const repliedTo = await thread.messages.fetch(replyId);
      cutoffTime = repliedTo.createdTimestamp;
      console.log(`📌 Reply detected, ignoring messages after: ${cutoffTime}`);
    } catch (error) {
      console.warn("⚠️ Could not fetch replied-to message. Proceeding without cutoff.");
    }
  }
  console.log(`📥 Fetching messages from thread: ${thread.name}`);
  const conversationMessages: { role: string; content: string }[] = [];
  try {
    const fetchedMessages = await thread.messages.fetch({ limit: 100 });
    const sorted = Array.from(fetchedMessages.values()).sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );
    for (const m of sorted) {
      if (m.createdTimestamp > cutoffTime) continue;
      if (![MessageType.Default, MessageType.Reply].includes(m.type)) continue;
      const role = m.author.bot ? 'assistant' : 'user';
      const fullText = await processInput(m, []);
      if (!fullText) continue;
      console.log(`📌 Found older message: "${fullText.slice(0, 50)}..." (Role: ${role})`);
      conversationMessages.push({ role, content: fullText });
    }
  } catch (error) {
    console.error(`❌ Error fetching messages from thread:`, error);
  }
  console.log(`📤 Sending new user input to assistant: "${newUserPrompt}"`);
  conversationMessages.push({ role: 'user', content: newUserPrompt });
  try {
    let answer = await runAssistantConversation(assistantId, conversationMessages);
    answer = answer.replace(/【.*?†source】/g, '');
    console.log(`✅ Assistant response received.`);
    if (answer.length > 1900) {
      const buffer = Buffer.from(answer, "utf-8");
      const fileAttachment = new AttachmentBuilder(buffer, { name: "response.txt" });
      await thread.send({
        content: "The response is too long; please see the attached file:",
        files: [fileAttachment],
      });
    } else {
      await thread.send(answer);
    }
  } catch (error) {
    console.error("❌ Error running assistant conversation:", error);
    await thread.send("There was an error processing your request. Please try again later.");
  }
}

/**
 * Handle automatic replies in an existing thread.
 */
async function handleAutoThreadMessage(message: any) {
  console.log(`🔄 Entered handleAutoThreadMessage for thread: ${message.channel.name}`);
  const newUserPrompt = await processInput(message, []);
  if (!newUserPrompt) {
    console.log(`⚠️ No valid input detected in handleAutoThreadMessage.`);
    return;
  }
  console.log(`📨 User prompt detected: "${newUserPrompt}"`);
  const thread = message.channel as ThreadChannel;
  await handleOngoingThreadMessage(thread, newUserPrompt, message);
}

client.on('messageCreate', async (message) => {
  // 1) Ignore messages from bots.
  if (message.author.bot) return;

  // 2) Check if message is a reply to a bot's stateless message.
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
        let answer = await runAssistantConversation(assistantId, conversation);
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

  // 3) If message is in a thread, auto-handle non-command messages.
  if (message.channel.isThread()) {
    const thread = message.channel as ThreadChannel;
    console.log(`📌 Received message inside thread: "${thread.name}" from ${message.author.tag}`);
    if (
      thread.name.includes('askBull Conversation') ||
      thread.name.includes('askBull Private Conversation')
    ) {
      if (!message.content.trim().startsWith('!')) {
        console.log(`📝 Auto-handling message in thread: ${thread.name}`);
        await handleAutoThreadMessage(message);
        return;
      }
    }
  }

  // 4) Process prefix-based commands.
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

// On startup, log in and update Assistant docs.
client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await updateAssistantDocs();
  // Optionally update docs at regular intervals (e.g., daily).
  setInterval(updateAssistantDocs, 60 * 60 * 24000);
});

client.login(DISCORD_BOT_TOKEN);
