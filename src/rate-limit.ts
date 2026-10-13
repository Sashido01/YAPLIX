import { Fault } from './contracts.ts';
export class RateLimit {
  private buckets=new Map<string,{count:number;until:number}>();
  take(key:string,limit=6,window=60000){
    const now=Date.now();for(const[id,b]of this.buckets)if(b.until<=now)this.buckets.delete(id);
    let bucket=this.buckets.get(key);if(!bucket){if(this.buckets.size>=1000)throw new Fault('RATE_LIMIT',429);bucket={count:0,until:now+window};this.buckets.set(key,bucket);}
    if(bucket.count>=limit)throw new Fault('RATE_LIMIT',429);bucket.count++;
  }
}
