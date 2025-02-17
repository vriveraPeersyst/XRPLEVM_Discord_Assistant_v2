// assistantClient.ts
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';

import { Message, ThreadChannel, MessageType, Attachment } from 'discord.js';
import Tesseract from 'tesseract.js';
import pdf from 'pdf-parse';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const ASSISTANT_API_BASE = process.env.ASSISTANT_API_BASE!; // e.g. "https://api.openai.com/v1/assistants"
const ASSISTANT_FILES_API_BASE = process.env.ASSISTANT_FILES_API_BASE!; // e.g. "https://api.openai.com/v1/files"

// Set up default headers, including the beta header:
axios.defaults.headers.common['Authorization'] = `Bearer ${OPENAI_API_KEY}`;
axios.defaults.headers.common['OpenAI-Beta'] = 'assistants=v2';

/**
 * Retry a promise-returning function a number of times with a delay.
 * @param fn The async function to execute.
 * @param context Descriptive context for logging errors.
 * @param maxAttempts Maximum number of attempts (default: 3).
 * @param delay Delay in milliseconds between attempts (default: 2000).
 */
async function retry<T>(
  fn: () => Promise<T>,
  context: string,
  maxAttempts = 3,
  delay = 2000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: unknown) {
      attempt++;
      if (axios.isAxiosError(error)) {
        console.error(
          `Attempt ${attempt} failed for ${context}:`,
          error.response?.data || error.message
        );
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

// -----------------
// File Upload Function
// -----------------
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

// -----------------
// Vector Store Functions
// -----------------
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

// -----------------
// Assistant Creation Using Vector Store (File Search Tool)
// -----------------
export async function createOrUpdateAssistantWithVectorStore(vectorStoreId: string): Promise<any> {
  const payload = {
    name: "XRPL EVM Docs Assistant",
    description: "Provides help to xrplevm users, developers and operators with examples from the XRPL EVM documentation.",
    model: "gpt-4o-mini", // or your chosen model
    instructions: "You are an expert in XRPL EVM documentation. Answer questions clearly and provide reference links to the docs without including any source annotations or citations. If the question has a straight-up answer, be concise and try not to exceed 1900 characters.",
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
    const response = await axios.post(
      `${ASSISTANT_API_BASE}`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    return response.data;
  }, `Creating/updating assistant with vector store ${vectorStoreId}`);
}

// ----------------------------------------------------
// Helper to Extract Text from a Single Message/Attachments
// ----------------------------------------------------
async function extractTextFromAttachment(attachment: Attachment): Promise<string> {
  const fileName = attachment.name?.toLowerCase() || "";
  const supportedDocExt = ['.txt', '.md', '.pdf', '.csv'];
  const supportedImgExt = ['.png', '.jpg', '.jpeg', '.gif'];

  try {
    // Documents
    if (supportedDocExt.some(ext => fileName.endsWith(ext))) {
      const isPDF = fileName.endsWith('.pdf');
      // Fetch raw data
      const response = await axios.get(attachment.url, {
        responseType: isPDF ? 'arraybuffer' : 'text'
      });
      if (isPDF) {
        const dataBuffer = Buffer.from(response.data);
        const pdfData = await pdf(dataBuffer);
        return pdfData.text;
      } else {
        // .txt, .md, .csv
        return response.data;
      }
    }
    // Images
    else if (supportedImgExt.some(ext => fileName.endsWith(ext))) {
      const imageResponse = await axios.get(attachment.url, {
        responseType: 'arraybuffer'
      });
      const imageBuffer = Buffer.from(imageResponse.data, 'binary');
      const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
      return text;
    }
    else {
      console.warn(`Unsupported attachment type: ${fileName}`);
      return '';
    }
  } catch (err) {
    console.error(`Error extracting text from attachment ${fileName}:`, err);
    return '';
  }
}

/**
 * Gathers text from the given message (including attachments).
 */
export async function processInputFromMessage(message: Message): Promise<string> {
  // 1) Base text from the message content
  let finalText = message.content.trim();

  // 2) If message has attachments, parse them
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

// ----------------------------------------------------
// Gather Entire Thread (Messages + Attachments)
// ----------------------------------------------------
export async function gatherThreadMessagesWithAttachments(
  thread: ThreadChannel,
  cutoffTime: number
): Promise<{ role: string; content: string }[]> {
  const conversation: { role: string; content: string }[] = [];

  // Fetch up to 100 messages (oldest first)
  const fetched = await thread.messages.fetch({ limit: 100 });
  const sorted = Array.from(fetched.values()).sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  for (const msg of sorted) {
    // Skip messages after cutoff (e.g. user replied to an older message)
    if (msg.createdTimestamp > cutoffTime) continue;

    // Skip system messages or blank content
    if (![MessageType.Default, MessageType.Reply].includes(msg.type)) continue;
    if (!msg.content.trim() && msg.attachments.size === 0) continue;

    // Bot vs user
    const role = msg.author.bot ? 'assistant' : 'user';

    // Extract text from the message itself + attachments
    const text = await processInputFromMessage(msg);
    if (!text) continue;

    conversation.push({ role, content: text });
  }

  return conversation;
}

// -----------------
// Run Assistant Conversation with a given array of messages
// -----------------
export async function runAssistantConversation(
  assistantId: string,
  conversationMessages: { role: string, content: string }[]
): Promise<string> {
  // Create a thread on the OpenAI side (not Discord)
  const threadRes = await axios.post(`https://api.openai.com/v1/threads`, {
    messages: conversationMessages,
  });
  const threadId = threadRes.data.id;
  console.log("Thread created with ID:", threadId);

  // Create a run on that thread
  const runRes = await axios.post(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    assistant_id: assistantId,
    instructions: "Please provide a detailed answer based on the conversation context, including references to the XRPL EVM documentation but without any source annotations or citations. Be concise.",
    max_prompt_tokens: 30000,
    max_completion_tokens: 30000,
  });
  let runResult = runRes.data;
  console.log("Run started with ID:", runResult.id);

  // Poll until status is complete
  while (runResult.status === 'queued' || runResult.status === 'in_progress') {
    await new Promise(r => setTimeout(r, 2000));
    const checkRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/runs/${runResult.id}`);
    runResult = checkRes.data;
  }

  // Log the run result for debugging
  console.log("Final run result:", JSON.stringify(runResult, null, 2));

  // Attempt to extract assistant reply
  let replyMessage;
  if (runResult.messages && Array.isArray(runResult.messages)) {
    replyMessage = runResult.messages.find((m: any) => m.role === 'assistant');
  }

  if (!replyMessage) {
    // fallback: fetch messages from the thread
    console.error("No assistant message found in run result. Checking thread messages...");
    const messagesRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages`);
    const messages = messagesRes.data.data;
    replyMessage = messages.find((m: any) => m.role === 'assistant');
  }

  if (replyMessage && replyMessage.content) {
    const content = replyMessage.content;
    if (Array.isArray(content)) {
      // Possibly multi-part
      return content.map((c: any) => c.text.value).join("\n");
    }
    return content;
  }

  return "No reply found.";
}
