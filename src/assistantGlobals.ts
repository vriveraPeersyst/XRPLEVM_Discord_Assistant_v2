// src/assistantGlobals.ts
let assistantId = "";

export function setAssistantId(id: string) {
  assistantId = id;
}

export function getAssistantId(): string {
  return assistantId;
}
