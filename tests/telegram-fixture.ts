import {createHmac} from 'node:crypto';
export function signedData(token:string,id=123456789,date=Math.floor(Date.now()/1000)){
 const p=new URLSearchParams({auth_date:String(date),user:JSON.stringify({id,first_name:'Synthetic'}),query_id:'synthetic-query'});const body=[...p.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>k+'='+v).join('\n');const secret=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',secret).update(body).digest('hex'));return p.toString();
}
