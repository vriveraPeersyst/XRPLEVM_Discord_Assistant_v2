// assistantClient.ts
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const ASSISTANT_API_BASE = process.env.ASSISTANT_API_BASE!; // e.g. "https://api.openai.com/v1/assistants"
const ASSISTANT_FILES_API_BASE = process.env.ASSISTANT_FILES_API_BASE!; // e.g. "https://api.openai.com/v1/files"

// Set up default headers, including the beta header:
axios.defaults.headers.common['Authorization'] = `Bearer ${OPENAI_API_KEY}`;
axios.defaults.headers.common['OpenAI-Beta'] = 'assistants=v2';

// -----------------
// File Upload Function
// -----------------
export async function uploadFile(filePath: string): Promise<any> {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('purpose', 'assistants');

  const response = await axios.post(`${ASSISTANT_FILES_API_BASE}`, form, {
    headers: form.getHeaders(),
  });
  return response.data;
}

// -----------------
// Vector Store Functions
// -----------------
export async function createVectorStore(storeName: string): Promise<string> {
  const payload = {
    name: storeName,
    // You can include additional settings if desired.
  };

  const response = await axios.post(
    'https://api.openai.com/v1/vector_stores',
    payload,
    { headers: { 'Content-Type': 'application/json' } }
  );
  // Return the vector store ID (e.g. "vs_abc123")
  return response.data.id;
}

export async function addFileToVectorStore(vectorStoreId: string, fileId: string): Promise<any> {
  const payload = { file_id: fileId };
  const response = await axios.post(
    `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`,
    payload,
    { headers: { 'Content-Type': 'application/json' } }
  );
  return response.data;
}

// -----------------
// Assistant Creation Using Vector Store (File Search Tool)
// -----------------
export async function createOrUpdateAssistantWithVectorStore(vectorStoreId: string): Promise<any> {
  const payload = {
    name: "XRPL EVM Docs Assistant",
    description: "Provides help to xrplevm users, developers and operators and examples from the XRPL EVM documentation.",
    model: "gpt-4o-mini", // or your chosen model
    instructions: "You are an expert in XRPL EVM documentation. Answer questions clearly and with reference links to the docs, but do not include any source annotations or citations in your response. If the question has a stright up answer reply concise and try not exceeding 1900 characters.",
    // Use the file_search tool (instead of code_interpreter) to search through many files
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

  const response = await axios.post(
    `${ASSISTANT_API_BASE}`,
    payload,
    { headers: { 'Content-Type': 'application/json' } }
  );
  return response.data;
}

// -----------------
// Run Assistant Conversation (unchanged)
// -----------------
// Create a new conversation thread and run a query.
export async function runAssistantConversation(assistantId: string, userPrompt: string): Promise<string> {
    // Sanitize prompt (remove extra surrounding quotes if present)
    const sanitizedPrompt = userPrompt.replace(/^"+|"+$/g, '');
    
    // Create a thread using the correct endpoint.
    const threadRes = await axios.post(`https://api.openai.com/v1/threads`, {
      messages: [{ role: "user", content: sanitizedPrompt }],
    });
    const threadId = threadRes.data.id;
    console.log("Thread created with ID:", threadId);
  
    // Create a run on that thread.
    const runRes = await axios.post(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      assistant_id: assistantId,
      instructions: "Please provide a detailed answer to the user's question, including references to the XRPL EVM documentation.",
      max_prompt_tokens: 30000,
      max_completion_tokens: 30000,
    });
    let runResult = runRes.data;
    console.log("Run started with ID:", runResult.id);
  
    // Poll until the run completes.
    while (runResult.status === 'queued' || runResult.status === 'in_progress') {
      await new Promise(r => setTimeout(r, 2000));
      const checkRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/runs/${runResult.id}`);
      runResult = checkRes.data;
    }
    
    // Log the full run result for inspection.
    console.log("Final run result:", JSON.stringify(runResult, null, 2));
  
    // Attempt to extract the assistant's reply from runResult.
    let replyMessage;
    if (runResult.messages && Array.isArray(runResult.messages) && runResult.messages.length > 0) {
      replyMessage = runResult.messages.find((msg: any) => msg.role === 'assistant');
    } else {
      console.error("No messages in run result, listing thread messages...");
      const messagesRes = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages`);
      const messages = messagesRes.data.data; // Assumes list response
      console.log("Thread messages:", JSON.stringify(messages, null, 2));
      replyMessage = messages.find((msg: any) => msg.role === 'assistant');
    }
    
    // If a reply message is found, extract its text.
    if (replyMessage && replyMessage.content) {
      const content = replyMessage.content;
      if (Array.isArray(content)) {
        // Join all text segments together.
        const text = content.map((c: any) => c.text.value).join("\n");
        return text;
      }
      return content;
    }
    
    return "No reply found.";
  }
  
  
  
  
  
