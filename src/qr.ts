import qrcode from 'qrcode-generator';
import { privateIPv4 } from './access.ts';
import { Fault } from './contracts.ts';

export function connectionQr(origin: string,publicHttps=false,phone=false) {
  const url = new URL(origin);
  if ((publicHttps?url.protocol!=='https:':url.protocol !== 'http:' || !privateIPv4(url.hostname)) || url.username || url.password || (phone ? url.pathname !== '/phone' || !/^#[A-Za-z0-9_-]{43}$/.test(url.hash) : url.pathname !== '/' || !!url.hash) || url.search) throw new Fault('LAN_QR_UNAVAILABLE');
  const code = qrcode(0, 'M'); code.addData(url.href, 'Byte'); code.make();
  return code.createSvgTag({ cellSize: 6, margin: 24, scalable: true });
}
