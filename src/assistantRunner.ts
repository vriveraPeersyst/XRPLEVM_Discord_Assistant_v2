// src/assistantRunner.ts
import { AttachmentBuilder, TextChannel, DMChannel, NewsChannel, TextBasedChannel } from 'discord.js';
import { runAssistantConversation } from './assistantClient';
import { getAssistantId } from './assistantGlobals';
import { semanticSearch, rerankSnippets } from './vectorSearch';

/**
 * Runs the assistant conversation, removes any source markers,
 * and sends the result to the provided text-based channel.
 */
export async function runAssistantAndSendReply(
  conversationMessages: { role: string; content: string }[],
  channel: TextBasedChannel
): Promise<void> {
  try {
    // Replace the single runAssistantConversation call in the stateless path:
    const raw = conversationMessages.slice(-1)[0].content;
    const hits = await semanticSearch(raw, 20, 0.75);
    const ranks = await rerankSnippets(raw, hits, 5);
    const context = ranks
      .map(r => `From ${r.path}:\n${hits[r.index - 1].text}`)
      .join('\n\n---\n\n');
    const msgs = [
      { role: 'system', content: `Use ONLY these contexts:\n\n${context}` },
      { role: 'user', content: raw }
    ];
    let answer = await runAssistantConversation(getAssistantId(), msgs);

    // Remove any "[source]" references
    answer = answer.replace(/【.*?†source】/g, '');

    // Define a type guard function to narrow down channel types
    const isSendableChannel = (ch: TextBasedChannel): ch is TextChannel | DMChannel | NewsChannel => 
      ch instanceof TextChannel || ch instanceof DMChannel || ch instanceof NewsChannel;

    if (isSendableChannel(channel)) {
      // If the answer is too long, send it as a file attachment
      if (answer.length > 1900) {
        const buffer = Buffer.from(answer, 'utf-8');
        const fileAttachment = new AttachmentBuilder(buffer, { name: 'response.txt' });
        await channel.send({
          content: 'The response is too long; please see the attached file:',
          files: [fileAttachment],
        });
      } else {
        await channel.send(answer);
      }
    } else {
      console.error('The channel does not support sending messages.');
    }
  } catch (error) {
    console.error('Error running assistant conversation:', error);
    if (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel) {
      await channel.send('There was an error processing your request. Please try again later.');
    }
  }
}
