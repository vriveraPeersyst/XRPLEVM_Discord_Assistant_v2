// src/assistantManager.ts
import { updateDocsRepos, convertAllMdToTxt } from './docsUpdater';
import { convertNonTextToTxt, gatherTextFiles } from './fileProcessor';
import { uploadFile, createOrUpdateAssistantWithVectorStore } from './assistantClient';
import { ScheduledContent, addScheduledContent } from './scheduler';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import {
  ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  ModalActionRowComponentBuilder
} from 'discord.js';

export async function addScheduledContentInteractive(interaction: ChatInputCommandInteraction) {
  // Create and show the modal to the user.
  const modal = new ModalBuilder()
    .setCustomId('addScheduledContentModal')
    .setTitle('Add Scheduled Content');

  // Create text inputs
  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Title')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter content title')
    .setRequired(true);

  const repeatIntervalInput = new TextInputBuilder()
    .setCustomId('repeatInterval')
    .setLabel('Repeat Interval (e.g., "3 minutes")')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., 3 minutes')
    .setRequired(true);

  const startTimeInput = new TextInputBuilder()
    .setCustomId('startTime')
    .setLabel('Start Time (YYYY-MM-DD HH:mm in UTC+1)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('2025-02-20 15:00')
    .setRequired(true);

  const promptInput = new TextInputBuilder()
    .setCustomId('prompt')
    .setLabel('Prompt')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter the prompt text...')
    .setRequired(true);

  const generalInfoInput = new TextInputBuilder()
    .setCustomId('generalInfo')
    .setLabel('General Info')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter general info or context...')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(titleInput),
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(repeatIntervalInput),
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(startTimeInput),
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(promptInput),
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(generalInfoInput)
  );

  await interaction.showModal(modal);

  // Wait for modal submission
  const modalInteraction = await interaction.awaitModalSubmit({
    filter: (i) => i.customId === 'addScheduledContentModal' && i.user.id === interaction.user.id,
    time: 300_000,
  }).catch(() => null) as ModalSubmitInteraction | null;

  if (!modalInteraction) {
    await interaction.followUp({ content: 'No modal submission received. Aborting.' });
    return;
  }

  // Defer the modal reply so we can later call followUp
  await modalInteraction.deferReply({ ephemeral: true });

  // Extract inputs
  const title = modalInteraction.fields.getTextInputValue('title');
  const repeatIntervalRaw = modalInteraction.fields.getTextInputValue('repeatInterval');
  const startTimeStr = modalInteraction.fields.getTextInputValue('startTime');
  const promptText = modalInteraction.fields.getTextInputValue('prompt');
  const generalInfo = modalInteraction.fields.getTextInputValue('generalInfo');

  // Convert repeat interval to cron expression
  const parts = repeatIntervalRaw.split(' ');
  const intervalVal = parseInt(parts[0], 10);
  const unit = parts[1]?.toLowerCase() ?? '';
  let cronExpression = '* * * * *';
  if (!isNaN(intervalVal) && intervalVal > 0) {
    if (unit.startsWith('minute')) {
      cronExpression = `*/${intervalVal} * * * *`;
    } else if (unit.startsWith('hour')) {
      cronExpression = `0 */${intervalVal} * * *`;
    } else if (unit.startsWith('day')) {
      cronExpression = `0 0 */${intervalVal} * *`;
    }
  }

  // Convert start time from "UTC+1" to UTC
  const [datePart, timePart] = startTimeStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const startDateUTC = new Date(Date.UTC(year, month - 1, day, hour - 1, minute));
  const startTimeISO = startDateUTC.toISOString();

  // Build the scheduled content object (store the channelId as well)
  const scheduledContent: ScheduledContent = {
    id: uuidv4(),
    title,
    status: 'active',
    cronExpression,
    startTime: startTimeISO,
    prompt: promptText,
    generalInfo,
    context: '',
    fileIteration: false,
    folderPath: undefined,
    channelId: interaction.channelId // Save the channel ID from which the command was issued
  };

  // Save the scheduled content
  addScheduledContent(scheduledContent);

  await modalInteraction.followUp({
    content: 'Scheduled content added successfully!',
    ephemeral: true
  });
}
