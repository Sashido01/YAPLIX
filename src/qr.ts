import qrcode from 'qrcode-generator';
import { privateIPv4 } from './access.ts';
import { Fault } from './contracts.ts';

export function connectionQr(origin: string,publicHttps=false) {
  const url = new URL(origin);
  if ((publicHttps?url.protocol!=='https:':url.protocol !== 'http:' || !privateIPv4(url.hostname)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Fault('LAN_QR_UNAVAILABLE');
  const code = qrcode(0, 'M'); code.addData(url.href, 'Byte'); code.make();
  return code.createSvgTag({ cellSize: 6, margin: 24, scalable: true });
}
