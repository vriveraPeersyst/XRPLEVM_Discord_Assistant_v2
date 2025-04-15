// src/threadHandler.ts
import { ThreadChannel, MessageType, AttachmentBuilder, ChannelType } from 'discord.js';
import { processInput } from './messageProcessor';
import { runAssistantConversation } from './assistantClient';
import { getAssistantId } from './assistantGlobals';

export async function handleThreadCommand(message: any, args: string[], isPrivate: boolean) {
  let thread: ThreadChannel;
  if (message.channel.isThread()) {
    thread = message.channel as ThreadChannel;
  } else {
    try {
      const threadOptions: any = {
        name: isPrivate ? `askBull Private Conversation` : `askBull Conversation`,
        autoArchiveDuration: 60,
        reason: 'Conversation with CKBull assistant',
      };
      if (isPrivate) {
        threadOptions.type = ChannelType.GuildPrivateThread;
      }
      thread = await message.startThread(threadOptions);
    } catch (error) {
      console.error('Error creating thread:', error);
      await message.reply('Could not create a thread for the conversation.');
      return;
    }
  }
  const finalPrompt = await processInput(message, args);
  if (!finalPrompt) {
    await thread.send('Please provide some text or attach a file/image with text.');
    return;
  }
  await handleOngoingThreadMessage(thread, finalPrompt, message);
}

export async function handleOngoingThreadMessage(
  thread: ThreadChannel,
  newUserPrompt: string,
  originalMessage: any
) {
  let cutoffTime = Infinity;
  const replyId = originalMessage.reference?.messageId;
  if (replyId) {
    try {
      const repliedTo = await thread.messages.fetch(replyId);
      cutoffTime = repliedTo.createdTimestamp;
      console.log(`Reply detected; ignoring messages after: ${cutoffTime}`);
    } catch (error) {
      console.warn("Could not fetch replied-to message. Proceeding without cutoff.");
    }
  }
  const conversationMessages: { role: string; content: string }[] = [];
  try {
    const fetchedMessages = await thread.messages.fetch({ limit: 100 });
    const sorted = Array.from(fetchedMessages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const m of sorted) {
      if (m.createdTimestamp > cutoffTime) continue;
      if (![MessageType.Default, MessageType.Reply].includes(m.type)) continue;
      const role = m.author.bot ? 'assistant' : 'user';
      const fullText = await processInput(m, []);
      if (!fullText) continue;
      conversationMessages.push({ role, content: fullText });
    }
  } catch (error) {
    console.error("Error fetching messages from thread:", error);
  }
  conversationMessages.push({ role: 'user', content: newUserPrompt });
  try {
    let answer = await runAssistantConversation(getAssistantId(), conversationMessages);
    answer = answer.replace(/【.*?†source】/g, '');
    if (answer.length > 1900) {
      const buffer = Buffer.from(answer, "utf-8");
      const fileAttachment = new AttachmentBuilder(buffer, { name: "response.txt" });
      await thread.send({
        content: "The response is too long; please see the attached file:",
        files: [fileAttachment],
      });
    } else {
      await thread.send(answer);
    }
  } catch (error) {
    console.error("Error running assistant conversation:", error);
    await thread.send("There was an error processing your request. Please try again later.");
  }
}

export async function handleAutoThreadMessage(message: any) {
  const newUserPrompt = await processInput(message, []);
  if (!newUserPrompt) {
    console.log("No valid input detected in auto-thread message.");
    return;
  }
  const thread = message.channel as ThreadChannel;
  await handleOngoingThreadMessage(thread, newUserPrompt, message);
}
