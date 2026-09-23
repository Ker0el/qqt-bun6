import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

export function decodePng(file) {
  const buf = readFileSync(file);
  let pos = 8; // skip signature
  let w=0,h=0,bitDepth=0,colorType=0,interlace=0;
  const idat = [];
  let palette = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos+4, pos+8);
    const data = buf.subarray(pos+8, pos+8+len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNG not supported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = {0:1,2:3,3:1,4:2,6:4}[colorType];
  if (!channels) throw new Error('unsupported colorType ' + colorType);
  const bpp = channels * (bitDepth/8);
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const prev = y ? out.subarray((y-1)*stride, y*stride) : Buffer.alloc(stride);
    const cur = out.subarray(y*stride, (y+1)*stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x-bpp] : 0, b = prev[x], c = x >= bpp ? prev[x-bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
        v += (pa<=pb && pa<=pc) ? a : (pb<=pc ? b : c); }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, bitDepth, colorType, channels, bpp, stride, data: out, palette, trns };
}

export function encodePng({w,h,bitDepth,colorType,channels,bpp,stride,data,palette,trns}) {
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y*(stride+1)] = 0; // filter none
    data.copy(raw, y*(stride+1) + 1, y*stride, (y+1)*stride);
  }
  const chunks = [];
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const crcTable = (() => { const t = []; for (let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xedb88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (const byte of b) c = crcTable[(c^byte)&0xff]^(c>>>8); return (c^0xffffffff)>>>0; };
  const chunk = (type, payload) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
    const t = Buffer.from(type,'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,payload])));
    return Buffer.concat([len,t,payload,crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4);
  ihdr[8]=bitDepth; ihdr[9]=colorType; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  chunks.push(sig, chunk('IHDR', ihdr));
  if (palette) chunks.push(chunk('PLTE', palette));
  if (trns) chunks.push(chunk('tRNS', trns));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw, {level:9})), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

export function pixel(img, x, y) {
  const i = y*img.stride + x*img.bpp;
  if (img.colorType === 6) return [img.data[i],img.data[i+1],img.data[i+2],img.data[i+3]];
  if (img.colorType === 2) return [img.data[i],img.data[i+1],img.data[i+2],255];
  if (img.colorType === 3) { const p = img.data[i]; return [img.palette[p*3],img.palette[p*3+1],img.palette[p*3+2], img.trns && p<img.trns.length ? img.trns[p] : 255]; }
  if (img.colorType === 0) return [img.data[i],img.data[i],img.data[i],255];
  return [0,0,0,0];
}
export function setPixel(img, x, y, r, g, b, a) {
  const i = y*img.stride + x*img.bpp;
  if (img.colorType === 6) { img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=a; }
  else if (img.colorType === 2) { img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; }
}
