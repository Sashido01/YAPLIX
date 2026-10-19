// Fixed budgets for explicitly selected durable ChatGPT jobs only.
export const CHATGPT_REQUEST_TIMEOUT_MS=45*60_000;
export const CHATGPT_JOB_TIMEOUT_MS=60*60_000;
export function longChatGpt(context?:{durableJob?:true;providerMode?:string}){
 return context?.durableJob===true&&context.providerMode==='chatgpt';
}
