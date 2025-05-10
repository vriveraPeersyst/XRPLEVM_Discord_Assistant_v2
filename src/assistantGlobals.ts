// src/assistantGlobals.ts
let assistantId = "";
let vectorStoreId = "";

export function setAssistantId(id: string) {
  assistantId = id;
}

export function getAssistantId(): string {
  return assistantId;
}

export function setVectorStoreId(id: string) {
  vectorStoreId = id;
}

export function getVectorStoreId(): string {
  return vectorStoreId;
}
