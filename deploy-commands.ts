// deploy-commands.ts
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import * as dotenv from 'dotenv';
dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const CLIENT_ID = process.env.CLIENT_ID!; // Your bot's application client ID
const GUILD_ID = process.env.GUILD_ID!;   // For testing, use your guild id

const commands = [
  new SlashCommandBuilder()
    .setName('xrplevm')
    .setDescription('Ask a question about XRPL EVM docs')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Your question (optional if file provided)')
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName('doc_attachment')
        .setDescription('Upload a .txt, .md, .pdf, or .csv file containing your prompt')
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName('image_attachment')
        .setDescription('Upload an image file to extract text as prompt')
        .setRequired(false)
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
