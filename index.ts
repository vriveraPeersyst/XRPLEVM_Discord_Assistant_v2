// index.ts
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  Attachment
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

// Create a Discord client with the necessary intents, including MessageContent.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Needed to read message content
  ]
});

// Global variable to hold your Assistant's ID.
let assistantId: string;

/**
 * Extracts text from a document attachment (.txt, .md, .pdf, .csv).
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
    console.error(`Error fetching or processing ${fileName}:`, error);
    return '';
  }
}

/**
 * Updates the documentation and creates/updates the Assistant using a vector store.
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
      console.error(`Error uploading file ${filePath}:`, err);
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
      console.error(`Error adding file id ${fileId} to vector store:`, err);
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
 * Listens for messages starting with the prefix and processes the !xrplevm command.
 */
client.on('messageCreate', async (message) => {
  // Ignore messages from bots.
  if (message.author.bot) return;

  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;

  // Parse the command and its arguments.
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (command === 'xrplevm') {
    let promptText = args.join(' ');
    let attachmentText = '';

    // Process any attachments.
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

    const finalPrompt = (promptText + '\n' + attachmentText).trim();

    if (!finalPrompt) {
      return message.reply('Please provide some text or attach a file/image with text.');
    }

    try {
      // Run the conversation with the Assistant.
      const answer = await runAssistantConversation(assistantId, finalPrompt);
    
      // Remove any source references like "【...†source】"
      const cleanedAnswer = answer.replace(/【.*?†source】/g, '');
    
      // If the answer is too long, send it as a file attachment.
      if (cleanedAnswer.length > 1900) {
        const buffer = Buffer.from(cleanedAnswer, 'utf-8');
        const fileAttachment = new AttachmentBuilder(buffer, { name: 'response.md' });
        await message.reply({
          content: 'The response is too long; please see the attached file:',
          files: [fileAttachment]
        });
      } else {
        await message.reply(cleanedAnswer);
      }
    } catch (error) {
      console.error('Error running assistant conversation:', error);
      await message.reply('There was an error processing your request. Please try again later.');
    }
  }
});

// On startup, log in and update the Assistant docs.
client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await updateAssistantDocs();
  // Optionally, update docs at regular intervals (e.g., hourly)
  setInterval(updateAssistantDocs, 60 * 60 * 1000);
});

client.login(DISCORD_BOT_TOKEN);
