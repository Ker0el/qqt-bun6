"""Import the original monster health bar for the water11 boss.
misc191..misc201 holds ten 39x6 bars plus one 41x8 backing plate (misc196).
Frame order below maps frame index = hp - 1, so hp 10 shows misc201 and hp 1 shows misc191.
"""
from pathlib import Path
from PIL import Image
import json

CLIENT=Path('D:/333/QQtang/QQTang5.2_Beta1Build1/QQTang5.2_Beta1Build1/QQTang5.2_Beta1Build1')
MISC=CLIENT/'data/object/misc'
DEST=Path(__file__).resolve().parents[1]/'public/assets'
manifest=json.loads((DEST/'manifest.json').read_text(encoding='utf8'))

# misc196 is the solid dark plate, not a health frame, so the ten bars skip it.
BARS=[191,192,193,194,195,197,198,199,200,201]
frames=[Image.open(MISC/f'misc{i}_stand.png').convert('RGBA') for i in BARS]
w=max(f.width for f in frames);h=max(f.height for f in frames)
assert (w,h)==(39,6),f'unexpected bar size {(w,h)}'
sheet=Image.new('RGBA',(w*len(frames),h))
for i,f in enumerate(frames):sheet.alpha_composite(f,(i*w,0))
sheet.save(DEST/'boss-hp.png')
manifest['boss-hp']={'src':'/assets/boss-hp.png','w':w,'h':h,'frames':len(frames),'duration':100}

plate=Image.open(MISC/'misc196_stand.png').convert('RGBA')
plate.save(DEST/'boss-hp-plate.png')
manifest['boss-hp-plate']={'src':'/assets/boss-hp-plate.png','w':plate.width,'h':plate.height,'frames':1,'duration':100}

(DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf8')
print(f'Imported boss health bar: {len(frames)} frames {w}x{h}, plate {plate.width}x{plate.height}')
