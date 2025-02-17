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

// Stores conversation arrays keyed by the bot's own message ID
// so we can pick up context when the user replies to that message.
const statelessConversations = new Map<string, { role: string; content: string }[]>();


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
  console.log(`📝 Processing message from: ${message.author.tag}`);
  console.log(`📌 Raw Message Content: "${message.content}"`);
  console.log(`📎 Attachments count: ${message.attachments.size}`);

  // Use message.content when args are empty
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
 * Stateless command: !xrplevm
 * Single-message conversation (no thread).
 */
async function handleStatelessCommand(message: any, args: string[]) {
  const finalPrompt = await processInput(message, args);
  if (!finalPrompt) {
    await message.reply('Please provide some text or attach a file/image with text.');
    return;
  }

  // Single-message conversation so far
  let conversationMessages = [{ role: 'user', content: finalPrompt }];

  try {
    let answer = await runAssistantConversation(assistantId, conversationMessages);
    // Remove any source annotations.
    answer = answer.replace(/【.*?†source】/g, '');

    // If the answer is too big for a normal message, attach as a file
    if (answer.length > 1900) {
      const buffer = Buffer.from(answer, 'utf-8');
      const fileAttachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
      
      // Send the bot reply
      const botReply = await message.reply({
        content: 'The response is too long; please see the attached file:',
        files: [fileAttachment],
      });

      // Add the assistant's final message to the conversation
      conversationMessages.push({ role: 'assistant', content: answer });

      // Store this entire conversation by the bot’s message ID
      statelessConversations.set(botReply.id, conversationMessages);

    } else {
      // Send a normal text reply
      const botReply = await message.reply(answer);

      // Add the assistant's final message to the conversation
      conversationMessages.push({ role: 'assistant', content: answer });

      // Store in the Map
      statelessConversations.set(botReply.id, conversationMessages);
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
 * Gather full conversation in the thread (including attachments)
 * up to the optional 'reply' cutoff.
 */
async function handleOngoingThreadMessage(
  thread: ThreadChannel,
  newUserPrompt: string,
  originalMessage: any
) {
  console.log(`🔄 Entered handleOngoingThreadMessage for thread: ${thread.name}`);

  // If the user is replying to an older message, we set a cutoff
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

  // Build the conversation array
  const conversationMessages: { role: string; content: string }[] = [];

  try {
    const fetchedMessages = await thread.messages.fetch({ limit: 100 });
    console.log(`📑 Total messages fetched: ${fetchedMessages.size}`);

    // Sort from oldest → newest
    const sortedMessages = Array.from(fetchedMessages.values()).sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    // For each older message, parse text + attachments
    for (const m of sortedMessages) {
      if (m.createdTimestamp > cutoffTime) continue;
      if (![MessageType.Default, MessageType.Reply].includes(m.type)) continue;

      // Determine role (bot vs. user)
      const role = m.author.bot ? "assistant" : "user";
      // Use processInput(...) with empty args to ensure attachments are parsed
      const fullText = await processInput(m, []);

      // If there's no content or attachments, skip
      if (!fullText) continue;

      console.log(`📌 Found older message: "${fullText.slice(0, 50)}..." (Role: ${role})`);
      conversationMessages.push({ role, content: fullText });
    }
  } catch (error) {
    console.error(`❌ Error fetching messages from thread:`, error);
  }

  console.log(`📤 Sending new user input to assistant: "${newUserPrompt}"`);

  // Finally, push the user's new message
  conversationMessages.push({ role: "user", content: newUserPrompt });

  try {
    let answer = await runAssistantConversation(assistantId, conversationMessages);
    answer = answer.replace(/【.*?†source】/g, "");
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
 * Handle automatic replies when users type in an existing XRPL EVM conversation thread,
 * without requiring a command prefix.
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
  // 1) Ignore messages from bots
  if (message.author.bot) return;

  // 2) Check if message is a reply to a bot's stateless message
  if (message.reference?.messageId) {
    const originalBotMsgId = message.reference.messageId;
    // If we have a conversation stored under that bot message ID, continue stateless conversation
    if (statelessConversations.has(originalBotMsgId)) {
      console.log(
        `↪️ User is replying to a stateless bot message: ${originalBotMsgId}`
      );

      const conversation = statelessConversations.get(originalBotMsgId)!;

      // Process user input (including attachments)
      const userPrompt = await processInput(message, []);
      if (!userPrompt) {
        console.log('⚠️ No valid input in user reply.');
        return;
      }

      // Add user message to the conversation
      conversation.push({ role: 'user', content: userPrompt });

      try {
        // Run the updated conversation with the assistant
        let answer = await runAssistantConversation(assistantId, conversation);
        answer = answer.replace(/【.*?†source】/g, '');

        // Send a new bot reply
        if (answer.length > 1900) {
          const buffer = Buffer.from(answer, 'utf-8');
          const fileAttachment = new AttachmentBuilder(buffer, {
            name: 'response.txt',
          });
          const botReply = await message.reply({
            content: 'The response is too long; please see the attached file:',
            files: [fileAttachment],
          });

          // Add assistant's new message
          conversation.push({ role: 'assistant', content: answer });

          // Update statelessConversations with the new message ID as the key
          statelessConversations.delete(originalBotMsgId);
          statelessConversations.set(botReply.id, conversation);
        } else {
          const botReply = await message.reply(answer);

          // Add assistant's new message
          conversation.push({ role: 'assistant', content: answer });

          // Update statelessConversations with the new message ID
          statelessConversations.delete(originalBotMsgId);
          statelessConversations.set(botReply.id, conversation);
        }
      } catch (error) {
        console.error('Error running assistant conversation (reply):', error);
        await message.reply(
          'There was an error processing your reply. Please try again later.'
        );
      }
      return; // End early, no further checks needed
    }
  }

  // 3) Check if message is in a thread
  if (message.channel.isThread()) {
    const thread = message.channel as ThreadChannel;
    console.log(
      `📌 Received message inside thread: "${thread.name}" from ${message.author.tag}`
    );

    // If the thread name indicates an XRPL EVM conversation
    if (
      thread.name.includes('XRPL EVM Conversation') ||
      thread.name.includes('XRPL EVM Private Conversation')
    ) {
      // If the message does NOT start with "!", auto-handle as a thread message
      if (!message.content.trim().startsWith('!')) {
        console.log(`📝 Auto-handling message in thread: ${thread.name}`);
        await handleAutoThreadMessage(message);
        return;
      }
    }
  }

  // 4) Check for prefix-based commands
  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;

  console.log(`🔹 Processing command: "${command}" from ${message.author.tag}`);

  if (command === 'xrplevm') {
    // Stateless command
    await handleStatelessCommand(message, args);
    // (handleStatelessCommand will store conversation keyed by bot message ID)
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
