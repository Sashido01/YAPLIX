const portrait=Object.freeze([Object.freeze({width:320,height:700}),Object.freeze({width:390,height:700})]);
export const BROWSER_VIEWPORTS=Object.freeze({
 'startup-input-pause':portrait,
 'full-html':Object.freeze([...portrait,Object.freeze({width:844,height:390})]),
});
export type BrowserScope=keyof typeof BROWSER_VIEWPORTS;
export const BROWSER_PROFILES=Object.freeze({
 'startup-input-pause':Object.freeze(BROWSER_VIEWPORTS['startup-input-pause'].map(v=>v.width)),
 'full-html':Object.freeze(BROWSER_VIEWPORTS['full-html'].map(v=>v.width)),
});
export function validBrowserProfiles(value:unknown,scope:unknown,allowHistorical=false):value is number[]{
 if(!Array.isArray(value)||(scope!=='startup-input-pause'&&scope!=='full-html'))return false;
 const matches=(expected:readonly number[])=>value.length===expected.length&&expected.every((width,i)=>value[i]===width);
 return matches(BROWSER_PROFILES[scope])||(allowHistorical&&scope==='full-html'&&matches(BROWSER_PROFILES['startup-input-pause']));
}
