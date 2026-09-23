"""Read the native v3 map and footprint metadata; prefer supplied PVE water art."""
from pathlib import Path
from zipfile import ZipFile
from PIL import Image, ImageSequence
import re, ast, struct, json

project=Path(__file__).resolve().parents[1]
dest=project/'public/assets'
archive=project.parents[1]/'work/qqtang-release/QQTang-Local.zip'
client=Path('D:/333/QQtang/QQTang5.2_Beta1Build1/QQTang5.2_Beta1Build1/QQTang5.2_Beta1Build1')
pve=Path('D:/333/PVE整合包v20240309/res/img/mapElem/water')
with ZipFile(archive) as z:
    prefix='QQTang-Local/runtime/client-patched/'
    raw=z.read(prefix+'map/water11_8.map')
    definitions=z.read(prefix+'object/mapElem/mapElem.py').decode('utf8')
assert struct.unpack_from('<i',raw)[0]==3
layers=[list(struct.unpack_from('<195i',raw,12+i*780)) for i in range(3)]
manifest=json.loads((dest/'manifest.json').read_text(encoding='utf8'))
def atlas(key,frames,duration=100):
    w=max(f.width for f in frames);h=max(f.height for f in frames)
    sheet=Image.new('RGBA',(w*len(frames),h))
    for i,f in enumerate(frames):sheet.alpha_composite(f,(i*w,0))
    sheet.save(dest/f'{key}.png')
    manifest[key]=dict(src=f'/assets/{key}.png',w=w,h=h,frames=len(frames),duration=duration)
objects=[];blocks=[0]*195;ground=layers[2];metadata={}
for id in sorted({v for layer in layers for v in layer if v>0}):
    section=re.search(r'class QQTMapElem'+str(id)+r'\(.*?(?=\nclass |\Z)',definitions,re.S).group(0)
    def field(name,default):
        match=re.search(r'^\s*'+name+r'\s*=\s*([^\n#]+)',section,re.M)
        return ast.literal_eval(match.group(1).strip()) if match else default
    size=field('size',(1,1));offset=field('offset',(0,0));attrs=field('GridAttr',(0,));life=field('LifeTime',-1)
    metadata[id]=dict(size=size,offset=offset,attrs=attrs,life=life)
    n=id-5000;native=client/f'data/object/mapElem/water/elem{n}_stand.png'
    paths=[native] if native.exists() else sorted(pve.glob(f'elem{n}_stand_0_*.png'))
    if not paths and (pve/f'elem{n}.png').exists():paths=[pve/f'elem{n}.png']
    if not paths:paths=[client/f'data/object/mapElem/water/elem{n}_stand.png']
    atlas(f'water-{id}',[Image.open(p).convert('RGBA') for p in paths])
    dying=client/f'data/object/mapElem/water/elem{n}_die.gif'
    if dying.exists():atlas(f'water-break-{id}',[f.convert('RGBA') for f in ImageSequence.Iterator(Image.open(dying))])
    # 玩家进洞时点亮的 trigger。优先用 PVE 包的逐帧 PNG：原版 GIF 的分帧在 PIL 下
    # 要做 disposal 合成，直接逐帧读出来和 PNG 版对不上。
    triggers=sorted(pve.glob(f'elem{n}_trigger_0_*.png'))
    if triggers:
        atlas(f'water-trigger-{id}',[Image.open(p).convert('RGBA') for p in triggers])
    else:
        trigger=client/f'data/object/mapElem/water/elem{n}_trigger.gif'
        if trigger.exists():atlas(f'water-trigger-{id}',[f.convert('RGBA') for f in ImageSequence.Iterator(Image.open(trigger))])
for layer in layers[:2]:
    for index,id in enumerate(layer):
        if id<=0:continue
        x=index%15;y=index//15;m=metadata[id];w,h=m['size']
        objects.append(dict(id=id,x=x,y=y,w=w,h=h,offset=m['offset'],breakable=m['life']>0))
        for dy in range(h):
            for dx in range(w):
                attr=m['attrs'][dy*w+dx if len(m['attrs'])>1 else 0]
                blocks[(y+dy)*15+x+dx]=0 if attr&1 else 8001 if m['life']>0 else 8005
at=12+2340;rules,count=struct.unpack_from('<2i',raw,at);assert rules==0;at+=8+count*4
count=struct.unpack_from('<i',raw,at)[0];at+=4
spawns=[]
for _ in range(count):
    row,col=struct.unpack_from('<2H',raw,at);at+=4;spawns.append([col,row])
data=dict(id='water11_8',name='水面 11 · 海盗水手',mode='water11',width=15,height=13,tileSize=40,blocks=blocks,ground=ground,structures=[0]*195,bases=[],spawns=spawns,objects=objects,nativeLayers=layers)
(dest/'water11.json').write_text(json.dumps(data,ensure_ascii=False),encoding='utf8')
for action in ['stand','walk']:
    for direction in range(4):
        path=client/f'data/object/cloth/cloth13201_{action}_{direction}.{ "gif" if action=="walk" else "png"}'
        im=Image.open(path);atlas(f'sailor-{action}-{direction}',[f.convert('RGBA') for f in ImageSequence.Iterator(im)],100)
for action in ['birth','die']:
    im=Image.open(client/f'data/object/cloth/cloth13201_{action}.gif');atlas(f'sailor-{action}',[f.convert('RGBA') for f in ImageSequence.Iterator(im)],100)
(dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf8')
print('Imported native water11:',len(objects),'objects,',len(spawns),'spawns')
