// 把角色精灵里的红色（头发/配饰）替换成蓝色，用于生成蓝队版本的共享美术。
// 皮肤是暖色（绿通道明显高于蓝），纯红是 g≈b，据此区分。
import { decodePng, encodePng, pixel, setPixel } from './png-util.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const isRed = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  // 纯红/深红：饱和度极高且绿蓝都低；皮肤绿通道在 120 以上，会被排除
  return r > 130 && sat > 0.75 && g < 100 && b < 100;
};

// 保留明暗层次：以红通道为强度映射到蓝色系
const toBlue = (r) => {
  const v = r / 255;
  return [Math.round(255 * v * 0.30), Math.round(255 * v * 0.55), Math.round(255 * v * 1.00)];
};

export function recolorImage(img) {
  let changed = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const [r, g, b, a] = pixel(img, x, y);
      if (a < 16 || !isRed(r, g, b)) continue;
      const [nr, ng, nb] = toBlue(r);
      setPixel(img, x, y, nr, ng, nb, a);
      changed++;
    }
  }
  return changed;
}

// ---- GIF 编解码（仅支持本项目用到的格式：GIF89a、全局调色板、GCE 透明、多帧）----
const lzwDecode = (data, minCodeSize) => {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let dict = [], codeSize = minCodeSize + 1, next = eoi + 1;
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; next = eoi + 1; codeSize = minCodeSize + 1; };
  reset();
  const out = []; let cur = [], bitBuf = 0, bitCnt = 0;
  for (const byte of data) {
    bitBuf |= byte << bitCnt; bitCnt += 8;
    while (bitCnt >= codeSize) {
      const code = bitBuf & ((1 << codeSize) - 1); bitBuf >>= codeSize; bitCnt -= codeSize;
      if (code === clear) { reset(); continue; }
      if (code === eoi) return out;
      let entry;
      if (code < next && dict[code]) entry = dict[code];
      else if (cur.length) entry = [...cur, cur[0]];
      else throw new Error('bad LZW code ' + code);
      out.push(...entry);
      if (cur.length) { dict[next++] = [...cur, entry[0]]; if (next === (1 << codeSize) && codeSize < 12) codeSize++; }
      cur = entry;
    }
  }
  return out;
};

const lzwEncode = (indices, minCodeSize) => {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let dict = new Map();
  const reset = () => { dict = new Map(); for (let i = 0; i < clear; i++) dict.set(String(i), i); next = eoi + 1; codeSize = minCodeSize + 1; };
  reset();
  const out = []; let bitBuf = 0, bitCnt = 0;
  const emit = (code) => { bitBuf |= code << bitCnt; bitCnt += codeSize; while (bitCnt >= 8) { out.push(bitBuf & 0xff); bitBuf >>= 8; bitCnt -= 8; } };
  emit(clear);
  let cur = '';
  for (const idx of indices) {
    const key = cur === '' ? String(idx) : cur + ',' + idx;
    if (dict.has(key)) { cur = key; continue; }
    emit(cur === '' ? idx : dict.get(cur));
    dict.set(key, next++);
    if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    cur = String(idx);
  }
  if (cur !== '') emit(dict.get(cur));
  emit(eoi);
  if (bitCnt > 0) out.push(bitBuf & 0xff);
  return Buffer.from(out);
};

export function decodeGif(file) {
  const src = readFileSync(file);
  if (src.toString('ascii', 0, 6) !== 'GIF89a' && src.toString('ascii', 0, 6) !== 'GIF87a') throw new Error('not a GIF');
  const w = src.readUInt16LE(6), h = src.readUInt16LE(8);
  const flags = src[10];
  let p = 13, gct = null;
  if (flags & 0x80) { const n = 1 << ((flags & 7) + 1); gct = src.subarray(p, p + n * 3); p += n * 3; }
  const frames = [];
  while (p < src.length) {
    const b = src[p];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = src[p + 1]; p += 2;
      if (label === 0xf9) {
        const size = src[p]; const packed = src[p + 1];
        const delay = src.readUInt16LE(p + 2);
        const transIndex = src[p + 4];
        const hasTrans = !!(packed & 1);
        p += size + 1;
        while (src[p] !== 0) p += src[p] + 1;
        p++;
        frames.push({ pending: { delay, hasTrans, transIndex } });
      } else {
        p += 1;
        while (src[p] !== 0) p += src[p] + 1;
        p++;
      }
    } else if (b === 0x2c) {
      const fx = src.readUInt16LE(p + 1), fy = src.readUInt16LE(p + 3);
      const fw = src.readUInt16LE(p + 5), fh = src.readUInt16LE(p + 7);
      const lflags = src[p + 9]; p += 10;
      let lct = null;
      if (lflags & 0x80) { const n = 1 << ((lflags & 7) + 1); lct = src.subarray(p, p + n * 3); p += n * 3; }
      const minCodeSize = src[p++];
      const chunks = [];
      while (src[p] !== 0) { const n = src[p]; chunks.push(src.subarray(p + 1, p + 1 + n)); p += 1 + n; }
      p++;
      const pixels = lzwDecode(Buffer.concat(chunks), minCodeSize);
      const last = frames[frames.length - 1];
      if (last && last.pending && last.pixels === undefined) {
        Object.assign(last, last.pending); delete last.pending;
        last.x = fx; last.y = fy; last.w = fw; last.h = fh;
        last.palette = lct || gct; last.pixels = pixels;
      } else {
        frames.push({ delay: 10, hasTrans: false, transIndex: 0, x: fx, y: fy, w: fw, h: fh, palette: lct || gct, pixels });
      }
    } else { p++; }
  }
  return { w, h, gct, frames };
}

export function encodeGif(gif) {
  const { w, h, frames } = gif;
  // 合并所有帧用到的颜色，构建统一的全局调色板
  const seen = new Map(); const palette = [];
  const pushColor = (r, g, b) => {
    const k = (r << 16) | (g << 8) | b;
    if (!seen.has(k)) { seen.set(k, palette.length); palette.push([r, g, b]); }
    return seen.get(k);
  };
  const frameIdx = frames.map(f => f.pixels.map(pi => {
    if (f.hasTrans && pi === f.transIndex) return -1;
    return pushColor(f.palette[pi*3], f.palette[pi*3+1], f.palette[pi*3+2]);
  }));
  if (palette.length > 256) throw new Error('颜色超过 256 种：' + palette.length);
  // GCT 大小必须是 2 的幂
  let gctBits = 1; while ((1 << gctBits) < palette.length) gctBits++;
  const gctSize = 1 << gctBits;
  const gct = Buffer.alloc(gctSize * 3);
  palette.forEach(([r,g,b], i) => { gct[i*3]=r; gct[i*3+1]=g; gct[i*3+2]=b; });
  // 透明色占用调色板最后一个槽位
  const transIndex = palette.length < gctSize ? palette.length : gctSize - 1;

  const parts = [Buffer.from('GIF89a','ascii')];
  const head = Buffer.alloc(7);
  head.writeUInt16LE(w,0); head.writeUInt16LE(h,2);
  head[4] = 0x80 | ((gctBits - 1) & 7); // 有全局调色板
  head[5] = 0; head[6] = 0;
  parts.push(head, gct);

  frames.forEach((f, fi) => {
    // 图形控制扩展
    const gce = Buffer.alloc(8);
    gce[0]=0x21; gce[1]=0xf9; gce[2]=4;
    gce[3] = (f.hasTrans ? 1 : 0) | 0x08; // 透明标志 + 处置方式"恢复背景"
    gce.writeUInt16LE(f.delay || 10, 4);
    gce[6] = f.hasTrans ? transIndex : 0;
    gce[7] = 0;
    parts.push(gce);
    // 图像描述符
    const desc = Buffer.alloc(10);
    desc[0]=0x2c;
    desc.writeUInt16LE(f.x||0,1); desc.writeUInt16LE(f.y||0,3);
    desc.writeUInt16LE(f.w,5); desc.writeUInt16LE(f.h,7);
    desc[9]=0; // 无局部调色板
    parts.push(desc);
    const minCodeSize = Math.max(2, gctBits);
    const idx = frameIdx[fi].map(i => i < 0 ? transIndex : i);
    parts.push(Buffer.from([minCodeSize]));
    const lzw = lzwEncode(idx, minCodeSize);
    for (let i = 0; i < lzw.length; i += 255) {
      const n = Math.min(255, lzw.length - i);
      parts.push(Buffer.from([n]), lzw.subarray(i, i + n));
    }
    parts.push(Buffer.from([0]));
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

if (process.argv[1] && process.argv[1].endsWith('blue-recolor.mjs')) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) { console.log('用法: node blue-recolor.mjs <输入.png|gif> <输出>'); process.exit(1); }
  if (src.endsWith('.gif')) {
    const gif = decodeGif(src);
    let total = 0;
    for (const f of gif.frames) {
      // 在调色板上直接改色，避免逐像素重建
      for (let i = 0; i < f.palette.length / 3; i++) {
        const r = f.palette[i*3], g = f.palette[i*3+1], b = f.palette[i*3+2];
        if (f.hasTrans && i === f.transIndex) continue;
        if (!isRed(r, g, b)) continue;
        const [nr, ng, nb] = toBlue(r);
        f.palette[i*3]=nr; f.palette[i*3+1]=ng; f.palette[i*3+2]=nb; total++;
      }
      f.palette = f.palette; // 就地修改；编码时会合并重建调色板
    }
    writeFileSync(dst, encodeGif(gif));
    console.log(`${src} -> ${dst}  帧数 ${gif.frames.length}  重着色调色板项 ${total}`);
  } else {
    const img = decodePng(src);
    const n = recolorImage(img);
    writeFileSync(dst, encodePng(img));
    console.log(`${src} -> ${dst}  重着色 ${n} 像素 / 共 ${img.w * img.h}`);
  }
}
