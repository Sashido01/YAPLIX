export const BROWSER_STORAGE_ERROR_PREFIX='YAPLIX_BROWSER_STORAGE_ACCESS:';
export const BROWSER_STORAGE_MARKER='__yaplixBrowserStorageAttempt';

export const BROWSER_STORAGE_INIT_SCRIPT=`(()=>{
  const prefix=${JSON.stringify(BROWSER_STORAGE_ERROR_PREFIX)};
  const marker=${JSON.stringify(BROWSER_STORAGE_MARKER)};
  const channel='yaplix_browser_storage_attempt';
  const report=name=>{
    try{
      if(window.parent!==window)window.parent.postMessage({channel,name},'*');
      else window[marker]=name;
    }catch{}
    throw new Error(prefix+name);
  };
  const deny=(target,key,label)=>{
    try{Object.defineProperty(target,key,{configurable:true,get(){return report(label)},set(){return report(label)}})}catch{}
  };
  for(const name of ['localStorage','sessionStorage','indexedDB','caches','cookieStore','openDatabase','requestFileSystem','webkitRequestFileSystem'])deny(window,name,name);
  deny(document,'cookie','document.cookie');
  deny(navigator,'storage','navigator.storage');
  addEventListener('message',event=>{
    const data=event.data;
    if(data?.channel===channel&&typeof data.name==='string')window[marker]=data.name;
  });
})();`;

export function browserStorageName(error:string):string|undefined{
  return error.startsWith(BROWSER_STORAGE_ERROR_PREFIX)?error.slice(BROWSER_STORAGE_ERROR_PREFIX.length):undefined;
}

export function browserStorageFeedback(name:string):string{
  return `Generated game attempted forbidden persistent browser storage (${name}). Games run in an opaque-origin sandboxed iframe; remove this dependency and keep game state in JavaScript memory.`;
}
