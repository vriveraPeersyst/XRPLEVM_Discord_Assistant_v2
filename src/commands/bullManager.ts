// src/commands/bullManager.ts
import { SlashCommandBuilder } from 'discord.js';

export const bullManagerCommand = new SlashCommandBuilder()
  .setName('bullmanager')
  .setDescription('Manage CKBull Assistant')
  .addSubcommand(subcommand =>
    subcommand
      .setName('update')
      .setDescription('Update Assistant Docs (re-upload vector files)')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List all scheduled content jobs')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Add a new scheduled content job')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('toggle')
      .setDescription('Toggle (pause/resume) a scheduled content job')
      .addStringOption(option =>
        option.setName('id')
          .setDescription('The scheduled job ID to toggle')
          .setRequired(true)
      )
  );
