// src/assistantRunner.ts
import { AttachmentBuilder, TextChannel, DMChannel, NewsChannel, TextBasedChannel } from 'discord.js';
import { runAssistantConversation } from './assistantClient';
import { getAssistantId } from './assistantGlobals';

/**
 * Runs the assistant conversation, removes any source markers,
 * and sends the result to the provided text-based channel.
 */
export async function runAssistantAndSendReply(
  conversationMessages: { role: string; content: string }[],
  channel: TextBasedChannel
): Promise<void> {
  try {
    // Run the assistant conversation
    let answer = await runAssistantConversation(getAssistantId(), conversationMessages);

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
