/** Only supported production routes. OpenRouter Free is a dynamic upstream alias. */
export const MODEL_CATALOG = Object.freeze([
  { mode:'ollama-cloud', provider:'ollama.com', model:'gemma4:31b', label:'Ollama Cloud · gemma4:31b', automatic:true },
  { mode:'openrouter', provider:'openrouter', model:'openrouter/free', label:'OpenRouter Free · динамическая модель', automatic:false },
  { mode:'chatgpt', provider:'chatgpt', model:'gpt-6.1-sol', label:'ChatGPT · gpt-6.1-sol · medium', automatic:false },
] as const);

export type ModelMode = typeof MODEL_CATALOG[number]['mode'];
export function modelForMode(mode: string) {
  return MODEL_CATALOG.find(entry=>entry.mode===mode);
}
