// index.ts
import {
  Client,
  GatewayIntentBits,
  Interaction,
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
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID; // The channel where the bot should respond

// Create Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

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
    console.error(`Error fetching or processing ${fileName}:`, error);
    return '';
  }
}

// Function to update docs and (re)create the Assistant using a vector store.
async function updateAssistantDocs() {
  console.log('Updating docs from GitHub...');
  await updateDocsRepo();
  const txtFiles = convertMdToTxt();
  console.log('Converted files:', txtFiles);

  // Upload files one by one and gather file IDs.
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

// Handle Discord slash commands
client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Ensure the command is used in the designated channel if specified.
  if (TARGET_CHANNEL_ID && interaction.channelId !== TARGET_CHANNEL_ID) {
    return interaction.reply({
      content: 'This command cannot be used in this channel.',
      ephemeral: true
    });
  }

  if (interaction.commandName === 'xrplevm') {
    // Immediately defer the reply to prevent the interaction from expiring.
    await interaction.deferReply({ ephemeral: true });

    // Retrieve prompt text (if provided)
    const promptText = interaction.options.getString('prompt') || '';

    // Retrieve document and image attachments (if provided)
    const docAttachment = interaction.options.getAttachment('doc_attachment');
    const imageAttachment = interaction.options.getAttachment('image_attachment');

    let attachmentText = '';

    // Process document attachment (.txt, .md, .pdf, .csv)
    if (docAttachment) {
      attachmentText += '\n' + (await extractTextFromDocAttachment(docAttachment));
    }

    // Process image attachment with OCR
    if (imageAttachment) {
      const supportedImageExtensions = ['.png', '.jpg', '.jpeg', '.gif'];
      if (
        imageAttachment.name &&
        supportedImageExtensions.some(ext => imageAttachment.name!.toLowerCase().endsWith(ext))
      ) {
        try {
          const imageResponse = await axios.get(imageAttachment.url, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data, 'binary');
          const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
          attachmentText += '\n' + text;
        } catch (error) {
          console.error('Error processing image attachment for OCR:', error);
        }
      } else {
        console.error('The provided image attachment is not a supported image file');
      }
    }

    // Combine text from the prompt and any attachment text.
    const finalPrompt = (promptText + '\n' + attachmentText).trim();

    if (!finalPrompt) {
      return interaction.editReply('Please provide a prompt text, a document file, or an image with text.');
    }

    try {
      // Run the conversation with the Assistant.
      const answer = await runAssistantConversation(assistantId, finalPrompt);

      // If the answer is too long, attach it as a .txt file.
      if (answer.length > 1900) {
        const buffer = Buffer.from(answer, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
        await interaction.editReply({
          content: 'The response is too long; please see the attached file:',
          files: [attachment]
        });
      } else {
        await interaction.editReply({ content: answer });
      }
    } catch (err) {
      console.error('Error running Assistant conversation:', err);
      await interaction.editReply('There was an error processing your request.');
    }
  }
});

// Log in to Discord and update docs on startup.
client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await updateAssistantDocs();

  // Optionally, update docs and the Assistant at regular intervals (e.g., hourly).
  setInterval(updateAssistantDocs, 60 * 60 * 1000);
});

client.login(DISCORD_BOT_TOKEN);
