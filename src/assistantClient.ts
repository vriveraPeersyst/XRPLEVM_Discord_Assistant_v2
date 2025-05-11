// src/assistantClient.ts
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';
import { Message, ThreadChannel, MessageType, Attachment } from 'discord.js';
import Tesseract from 'tesseract.js';
import pdf from 'pdf-parse';

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const ASSISTANT_API_BASE = process.env.ASSISTANT_API_BASE!; // e.g. "https://api.openai.com/v1/assistants"
const ASSISTANT_FILES_API_BASE = process.env.ASSISTANT_FILES_API_BASE!; // e.g. "https://api.openai.com/v1/files"

// Set up default headers, including the beta header:
axios.defaults.headers.common['Authorization'] = `Bearer ${OPENAI_API_KEY}`;
axios.defaults.headers.common['OpenAI-Beta'] = 'assistants=v2';

async function retry<T>(
  fn: () => Promise<T>,
  context: string,
  maxAttempts = 3,
  delay = 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: unknown) {
      attempt++;
      if (axios.isAxiosError(error)) {
        console.error(`Attempt ${attempt} failed for ${context}:`, error.response?.data || error.message);
      } else {
        console.error(`Attempt ${attempt} failed for ${context}:`, error);
      }
      if (attempt >= maxAttempts) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export async function uploadFile(filePath: string): Promise<any> {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('purpose', 'assistants');
  return await retry(async () => {
    const response = await axios.post(`${ASSISTANT_FILES_API_BASE}`, form, {
      headers: form.getHeaders(),
    });
    return response.data;
  }, `Uploading file at ${filePath}`);
}

export async function uploadFilesBatch(filePaths: string[], batchSize = 10): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    const uploads = batch.map(fp => uploadFile(fp).catch(e => ({ error: e, file: fp })));
    const batchResults = await Promise.all(uploads);
    results.push(...batchResults);
  }
  return results;
}

export async function createVectorStore(storeName: string): Promise<string> {
  const payload = { name: storeName };
  return await retry(async () => {
    const response = await axios.post(
      'https://api.openai.com/v1/vector_stores',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    return response.data.id;
  }, `Creating vector store "${storeName}"`);
}

export async function addFileToVectorStore(vectorStoreId: string, fileId: string): Promise<any> {
  const payload = { file_id: fileId };
  return await retry(async () => {
    const response = await axios.post(
      `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    return response.data;
  }, `Adding file id ${fileId} to vector store ${vectorStoreId}`);
}

export async function createOrUpdateAssistantWithVectorStore(vectorStoreId: string): Promise<any> {
  const payload = {
    name: "XRPL EVM Docs Assistant",
    description: "Provides help to xrplevm users, developers and operators with examples from the XRPL EVM documentation.",
    model: "gpt-4o-mini", // or your chosen model
    instructions: "You are an expert in XRPL EVM documentation. Answer questions clearly and provide reference links to the docs without including any source annotations or citations. If the question has a straight-up answer, be concise and try not to exceed 1900 characters. You have access to a vector store with the following docs: XRPL EVM Docs, Cosmos Docs, Axelar Docs, Evmos docs and Band Protocol docs.",
    tools: [{ type: "file_search" }],
    tool_resources: {
      file_search: {
        vector_store_ids: [vectorStoreId]
      }
    },
    metadata: {},
    top_p: 1.0,
    temperature: 1.0,
    response_format: "auto"
  };

  return await retry(async () => {
    const response = await axios.post(`${ASSISTANT_API_BASE}`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data;
  }, `Creating/updating assistant with vector store ${vectorStoreId}`);
}

async function extractTextFromAttachment(attachment: Attachment): Promise<string> {
  const fileName = attachment.name?.toLowerCase() || "";
  const supportedDocExt = ['.txt', '.md', '.pdf', '.csv'];
  const supportedImgExt = ['.png', '.jpg', '.jpeg', '.gif'];

  try {
    if (supportedDocExt.some(ext => fileName.endsWith(ext))) {
      const isPDF = fileName.endsWith('.pdf');
      const response = await axios.get(attachment.url, { responseType: isPDF ? 'arraybuffer' : 'text' });
      if (isPDF) {
        const dataBuffer = Buffer.from(response.data);
        const pdfData = await pdf(dataBuffer);
        return pdfData.text;
      } else {
        return response.data;
      }
    } else if (supportedImgExt.some(ext => fileName.endsWith(ext))) {
      const imageResponse = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data, 'binary');
      const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
      return text;
    } else {
      console.warn(`Unsupported attachment type: ${fileName}`);
      return '';
    }
  } catch (err) {
    console.error(`Error extracting text from attachment ${fileName}:`, err);
    return '';
  }
}

export async function processInputFromMessage(message: Message): Promise<string> {
  let finalText = message.content.trim();
  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      const extracted = await extractTextFromAttachment(attachment);
      if (extracted) {
        finalText += `\n${extracted}`;
      }
    }
  }
  return finalText.trim();
}

export async function gatherThreadMessagesWithAttachments(
  thread: ThreadChannel,
  cutoffTime: number
): Promise<{ role: string; content: string }[]> {
  const conversation: { role: string; content: string }[] = [];
  const fetched = await thread.messages.fetch({ limit: 100 });
  const sorted = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  for (const msg of sorted) {
    if (msg.createdTimestamp > cutoffTime) continue;
    if (![MessageType.Default, MessageType.Reply].includes(msg.type)) continue;
    if (!msg.content.trim() && msg.attachments.size === 0) continue;
    const role = msg.author.bot ? 'assistant' : 'user';
    const text = await processInputFromMessage(msg);
    if (!text) continue;
    conversation.push({ role, content: text });
  }
  return conversation;
}

export async function runAssistantConversation(
  assistantId: string,
  conversationMessages: { role: string, content: string }[]
): Promise<string> {
  const threadRes = await axios.post(`https://api.openai.com/v1/threads`, {
    messages: conversationMessages,
  });
  const threadId = threadRes.data.id;
  console.log("Thread created with ID:", threadId);

  const runRes = await axios.post(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    assistant_id: assistantId,
    instructions: "Please provide a detailed answer based on the conversation context.",
    max_prompt_tokens: 20000,
    max_completion_tokens: 20000,
  });
  let runResult = runRes.data;
  console.log("Run started with ID:", runResult.id);

  while (runResult.status === 'queued' || runResult.status === 'in_progress') {
    await new Promise(r => setTimeout(r, 2000));
    const checkRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/runs/${runResult.id}`);
    runResult = checkRes.data;
  }

  console.log("Final run result:", JSON.stringify(runResult, null, 2));

  let replyMessage;
  if (runResult.messages && Array.isArray(runResult.messages)) {
    replyMessage = runResult.messages.find((m: any) => m.role === 'assistant');
  }

  if (!replyMessage) {
    console.error("No assistant message found in run result. Checking thread messages...");
    const messagesRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages`);
    const messages = messagesRes.data.data;
    replyMessage = messages.find((m: any) => m.role === 'assistant');
  }

  if (replyMessage && replyMessage.content) {
    const content = replyMessage.content;
    if (Array.isArray(content)) {
      return content.map((c: any) => c.text.value).join("\n");
    }
    return content;
  }
  return "No reply found.";
}
