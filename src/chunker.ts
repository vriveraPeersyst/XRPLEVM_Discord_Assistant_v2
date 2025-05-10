import { split } from 'sentence-splitter';

/**
 * Chunk text into ≈500-token chunks with 15% overlap at sentence boundaries.
 */
export function chunkText(
  text: string,
  maxTokens = 500,
  overlapTokens = 75
): string[] {
  // Split into sentences
  const sentences = split(text)
    .filter((n: any) => n.type === 'Sentence')
    .map((n: any) => n.raw);

  const chunks: string[] = [];
  let buffer = '';

  for (const sent of sentences) {
    const bufTokens = buffer.split(/\s+/).length;
    const sentTokens = sent.split(/\s+/).length;

    if (bufTokens + sentTokens > maxTokens) {
      chunks.push(buffer.trim());
      // Slide overlap tokens forward
      const tail = buffer
        .split(/\s+/)
        .slice(-overlapTokens)
        .join(' ');
      buffer = tail;
    }
    buffer += ' ' + sent;
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }
  return chunks;
}
