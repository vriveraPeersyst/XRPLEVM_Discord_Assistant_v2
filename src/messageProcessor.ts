// src/messageProcessor.ts
import axios from 'axios';
import Tesseract from 'tesseract.js';
import pdf from 'pdf-parse';
import { Message, Attachment } from 'discord.js';

export async function extractTextFromDocAttachment(attachment: Attachment): Promise<string> {
  const fileName = attachment.name?.toLowerCase() || "";
  const isPDF = fileName.endsWith('.pdf');
  try {
    const response = await axios.get(attachment.url, { responseType: isPDF ? 'arraybuffer' : 'text' });
    if (isPDF) {
      const dataBuffer = Buffer.from(response.data);
      const pdfData = await pdf(dataBuffer);
      return pdfData.text;
    } else if (fileName.endsWith('.txt') || fileName.endsWith('.md') || fileName.endsWith('.csv')) {
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

export async function processInputFromMessage(message: Message): Promise<string> {
  let finalText = message.content.trim();
  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      const extracted = await extractTextFromDocAttachment(attachment);
      if (extracted) {
        finalText += `\n${extracted}`;
      }
    }
  }
  return finalText.trim();
}

export async function processInput(message: any, args: string[]): Promise<string> {
  let promptText = args.length > 0 ? args.join(' ') : message.content.trim();
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
          console.error('Error processing image for OCR:', error);
        }
      } else {
        console.error(`Unsupported attachment type: ${fileName}`);
      }
    }
  }
  return (promptText + '\n' + attachmentText).trim();
}
