// index.ts
import {
    Client,
    GatewayIntentBits,
    Interaction,
    AttachmentBuilder
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
  
  dotenv.config();
  
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
  const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID; // The channel where the bot should respond
  
  // Create Discord client
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  
  // Global variable to hold your Assistant's ID.
  let assistantId: string;
  
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
      const userPrompt =
        interaction.options.getString('prompt') || 'Help me with XRPL EVM';
  
      // Acknowledge the command immediately.
      await interaction.reply({
        content: 'Processing your request…',
        ephemeral: true
      });
  
      try {
        // Run the conversation with the Assistant.
        const answer = await runAssistantConversation(assistantId, userPrompt);
  
        // If the answer is too long, attach it as a .txt file.
        if (answer.length > 1900) {
          const buffer = Buffer.from(answer, 'utf-8');
          const attachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
          await interaction.followUp({
            content: 'The response is too long; please see the attached file:',
            files: [attachment],
            ephemeral: true
          });
        } else {
          await interaction.followUp({ content: answer, ephemeral: true });
        }
      } catch (err) {
        console.error('Error running Assistant conversation:', err);
        await interaction.followUp({
          content: 'There was an error processing your request.',
          ephemeral: true
        });
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
  