from pathlib import Path
from PIL import Image, ImageSequence
import json, shutil

root = Path('D:/333')
dest = Path(__file__).resolve().parents[1] / 'public/assets'
manifest = json.loads((dest / 'manifest.json').read_text(encoding='utf8'))
def atlas(name, frames, duration):
    w, h = max(f.width for f in frames), max(f.height for f in frames)
    sheet = Image.new('RGBA', (w * len(frames), h))
    for i, frame in enumerate(frames):
        sheet.alpha_composite(frame, (i * w + (w-frame.width)//2, h-frame.height))
    sheet.save(dest / f'{name}.png')
    manifest[name] = dict(src=f'/assets/{name}.png', w=w, h=h, frames=len(frames), duration=duration)
cry = next((root/'QQtang').rglob('cloth10901_cry.gif'))
for number in range(1,11):
    source=Image.open(cry.parent.parent/'flame'/f'flame{number}_stand.gif')
    atlas(f'flame{number}', [f.convert('RGBA') for f in ImageSequence.Iterator(source)], source.info.get('duration',500))
bun = Image.open(cry.parent.parent/'cap/cap22_stand.gif')
atlas('bun-original', [f.convert('RGBA') for f in ImageSequence.Iterator(bun)], bun.info.get('duration',500))
for number in [1,2,3,23,24,25,42]:
    source=next((cry.parent.parent/'item').glob(f'item{number}_stand.*'))
    im=Image.open(source)
    atlas(f'item{number}', [f.convert('RGBA') for f in ImageSequence.Iterator(im)], im.info.get('duration',100))
im = Image.open(cry)
shutil.copy2(cry, dest/'death-cry.gif')
atlas('death-cry', [f.convert('RGBA') for f in ImageSequence.Iterator(im)], 500)
halo = root/'QQtang/BOSS单机版/BOSS单机版m1/resources/magic/magic0139'
atlas('spawn-halo', [Image.open(p).convert('RGBA') for p in sorted(halo.glob('*.png'), key=lambda p:int(p.stem))], 100)
for key in 'tyuiop':
    atlas(f'emote-{key}', [Image.open(root/f'QQtang/音效/快捷键表情/按键{key}.png').convert('RGBA')], 100)
shutil.copy2(root/'PVE整合包v20240309/res/font/simsun.ttc', dest/'simsun.ttc')
shutil.copy2(root/'PVE整合包v20240309/res/font/century.ttf', dest/'century.ttf')
(dest/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf8')
