import axios from 'axios';
import { runAssistantConversation, OPENAI_API_KEY } from './assistantClient';
import { getAssistantId, getVectorStoreId } from './assistantGlobals';

axios.defaults.headers.common['Authorization'] = `Bearer ${OPENAI_API_KEY}`;

// Get embedding for a query
async function getEmbedding(text: string): Promise<number[]> {
  const res = await axios.post('https://api.openai.com/v1/embeddings', {
    model: 'text-embedding-ada-002',
    input: text
  });
  return res.data.data[0].embedding;
}

// Vector search + threshold
export async function semanticSearch(
  query: string,
  topK = 20,
  threshold = 0.75
): Promise<{ text: string; path: string; score: number }[]> {
  const storeId = getVectorStoreId();
  const embedding = await getEmbedding(query);
  const res = await axios.post(
    `https://api.openai.com/v1/vector_stores/${storeId}/search`,
    { embedding, top_k: topK }
  );
  return res.data.data
    .filter((hit: any) => hit.score >= threshold)
    .map((hit: any) => ({
      text: hit.metadata.text,
      path: hit.metadata.path,
      score: hit.score
    }));
}

// LLM-based reranking of the top snippets
export async function rerankSnippets(
  query: string,
  snippets: { text: string; path: string; score: number }[],
  topN = 5
): Promise<{ index: number; path: string; rationale: string }[]> {
  const system = {
    role: 'system',
    content: 'Rank these snippets by relevance to the user’s question.'
  };
  const user = {
    role: 'user',
    content:
      `Question: ${query}\n\n` +
      snippets
        .map((s, i) => `${i + 1}) [${s.path}] ${s.text}`)
        .join('\n\n') +
      `\n\nReturn the top ${topN} as JSON array [{index, path, rationale}].`
  };
  const reply = await runAssistantConversation(getAssistantId(), [system, user]);
  return JSON.parse(reply) as { index: number; path: string; rationale: string }[];
}
