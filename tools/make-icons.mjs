// 从一张源图生成站点图标（favicon / apple-touch-icon）。
// 用箱式采样做降采样：对每个目标像素取源图对应区域的平均色，
// 比最近邻平滑得多，适合细节丰富的图缩到 32px 这种场景。
import { decodePng, encodePng, pixel } from './png-util.mjs';
import { writeFileSync } from 'node:fs';

export function resizeBox(src, dw, dh) {
  const out = { w: dw, h: dh, bitDepth: 8, colorType: 6, channels: 4, bpp: 4, stride: dw * 4, data: Buffer.alloc(dw * dh * 4) };
  const sx = src.w / dw, sy = src.h / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(src.h, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(src.w, Math.ceil((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const [pr, pg, pb, pa] = pixel(src, xx, yy);
          // 按 alpha 加权，避免透明边缘把颜色拉向黑
          const w = pa / 255;
          r += pr * w; g += pg * w; b += pb * w; a += pa; n += w || 0.0001;
        }
      }
      const cnt = (y1 - y0) * (x1 - x0);
      const i = (y * dw + x) * 4;
      out.data[i] = Math.round(r / n);
      out.data[i + 1] = Math.round(g / n);
      out.data[i + 2] = Math.round(b / n);
      out.data[i + 3] = Math.round(a / cnt);
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('make-icons.mjs')) {
  const [src, outdir] = process.argv.slice(2);
  if (!src || !outdir) { console.log('用法: node make-icons.mjs <源图.png> <输出目录>'); process.exit(1); }
  const img = decodePng(src);
  console.log(`源图 ${img.w}x${img.h}`);
  const targets = [
    ['favicon-32.png', 32, 32],
    ['favicon-64.png', 64, 64],
    ['apple-touch-icon.png', 180, 180],
  ];
  for (const [name, w, h] of targets) {
    writeFileSync(`${outdir}/${name}`, encodePng(resizeBox(img, w, h)));
    console.log(`  ${name.padEnd(22)} ${w}x${h}`);
  }
}
