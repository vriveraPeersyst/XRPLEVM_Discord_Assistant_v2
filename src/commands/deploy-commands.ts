// src/commands/deploy-commands.ts
import { REST, Routes } from 'discord.js';
import { bullManagerCommand } from './bullManager';
import dotenv from 'dotenv';

dotenv.config();

// Convert your command(s) to JSON
const commands = [
  bullManagerCommand.toJSON()
];

// Initialize Discord REST API client with your bot token.
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);
    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID),
        { body: commands }
      );
      console.log('Successfully reloaded guild commands.');
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID!),
        { body: commands }
      );
      console.log('Successfully reloaded global commands.');
    }
  } catch (error) {
    console.error(error);
  }
})();
