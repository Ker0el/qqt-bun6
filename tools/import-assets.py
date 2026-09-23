"""Import the user-provided QQ Tang resources without modifying the source.
PNG/GIF -> browser atlases; native bun06_8.map -> JSON. Pillow is required.
"""
from pathlib import Path
from PIL import Image, ImageSequence
import struct, json, shutil, colorsys

ROOT=Path('D:/333/QQtang')
CLIENT=ROOT/'QQTang5.2_Beta1Build1/QQTang5.2_Beta1Build1/QQTang5.2_Beta1Build1'
RES=ROOT/'BOSS单机版/BOSS单机版m1/resources'
OBJ=CLIENT/'data/object'
DEST=Path(__file__).resolve().parents[1]/'public/assets'
DEST.mkdir(parents=True,exist_ok=True)
manifest=json.loads((DEST/'manifest.json').read_text(encoding='utf8')) if (DEST/'manifest.json').exists() else {}

def save_atlas(name, frames, duration=100):
    w=max(f.width for f in frames);h=max(f.height for f in frames)
    atlas=Image.new('RGBA',(w*len(frames),h))
    for i,f in enumerate(frames):atlas.alpha_composite(f,(i*w,0))
    atlas.save(DEST/f'{name}.png')
    manifest[name]={'src':f'/assets/{name}.png','w':w,'h':h,'frames':len(frames),'duration':duration}

def import_image(name,path):
    image=Image.open(path)
    frames=[frame.convert('RGBA') for frame in ImageSequence.Iterator(image)]
    save_atlas(name,frames,image.info.get('duration',100))

for i in range(1,29):
    p=OBJ/'mapElem/bun'/f'elem{i}_stand.png'
    if p.exists():import_image(f'tile{i}',p)
for i in [1,2,3,4,7]:import_image(f'break{i}',OBJ/'mapElem/bun'/f'elem{i}_die.gif')
for name in ['dlg_playerList','dlg_statusBar','gameTop','gameLeft','btn_saveReplay']:
    ps=list((OBJ/'ui/game').glob(name+'.*'))
    if ps:import_image(name,ps[0])
for i in [1,2]:import_image(f'bomb{i}',OBJ/'bomb'/f'bomb{i}_stand.gif')
for i in range(1,11):import_image(f'flame{i}',OBJ/'flame'/f'flame{i}_stand.gif')
for i in range(1,12):
    p=OBJ/'item'/f'item{i}_stand.gif'
    if p.exists():import_image(f'item{i}',p)
digits=Image.open(OBJ/'ui/common/number3.png').convert('RGBA')
save_atlas('timer-digits',[digits.crop((i*27,0,(i+1)*27,36)) for i in range(15)])
fire=ROOT/'火焰糖泡.gif'
if fire.exists():import_image('bomb-fire',fire)

conf=json.loads((RES/'player/player9.json').read_text())
order=['foot','leg','body','cloth','npack','head','face','hair','cap']
def blue(image):
    # Team palette conversion of the supplied red character; geometry is unchanged.
    result=image.copy();pix=result.load()
    for y in range(result.height):
        for x in range(result.width):
            r,g,b,a=pix[x,y]
            if a and r>g*1.45 and r>b*1.35:
                hh,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
                if hh<0.055 or hh>0.94:
                    rr,gg,bb=colorsys.hsv_to_rgb(0.605,s,v)
                    pix[x,y]=(round(rr*255),round(gg*255),round(bb*255),a)
    return result

for action in ['stand','walk']:
    for direction in range(4):
        layers=[]
        for part in order:
            if part not in conf:continue
            p=OBJ/part/f'{part}{conf[part]}_{action}_{direction}.{"gif" if action=="walk" else "png"}'
            if not p.exists():p=OBJ/part/f'{part}{conf[part]}_stand_{direction}.png'
            if p.exists():layers.append([f.convert('RGBA') for f in ImageSequence.Iterator(Image.open(p))])
        frames=[]
        for i in range(max(len(layer) for layer in layers)):
            im=Image.new('RGBA',(100,100))
            for layer in layers:im.alpha_composite(layer[i%len(layer)])
            frames.append(im)
        save_atlas(f'prince-red-{action}-{direction}',frames,80)
        save_atlas(f'prince-blue-{action}-{direction}',[blue(f) for f in frames],80)

for action in ['trigger','die']:
    original=Image.open(OBJ/'cloth'/f'cloth10901_{action}.gif')
    frames=[frame.convert('RGBA') for frame in ImageSequence.Iterator(original)]
    save_atlas(f'prince-red-{action}',frames,100)
    save_atlas(f'prince-blue-{action}',[blue(frame) for frame in frames],100)

for name in ['ReadyGo','bomb','uiNormal','uiMain','uiFail','uiLeave']:
    src=CLIENT/'sound'/f'{name}.wav'
    if src.exists():shutil.copy2(src,DEST/f'{name}.wav')
for name in ['bun','PlayerWin','PlayerLoss']:
    shutil.copy2(CLIENT/'music'/f'{name}.ogg',DEST/f'{name}.ogg')
audio_root=ROOT/'音效'
for source,target in {'泡泡爆炸.wav':'bomb.wav','人物被困的泡泡爆炸.wav':'trapped-pop.wav','自己放炮声音（只能自己听见）.wav':'place.wav','ready_go.wav':'ReadyGo.wav','uiMain点击.wav':'uiMain.wav','uiNormal.wav':'uiNormal.wav','uiFail.wav':'uiFail.wav','uiLeave.wav':'uiLeave.wav','match.ogg':'match.ogg'}.items():
    if (audio_root/source).exists():shutil.copy2(audio_root/source,DEST/target)
for direction in ['C','U','D','L','R']:
    sources=sorted((audio_root/'flame泡泡爆炸图片用这个').glob(f'flame_{direction}_*.png'))
    if sources:save_atlas(f'flame-custom-{direction}',[Image.open(p).convert('RGBA') for p in sources],70)
for source,target in [(CLIENT/'object/ui/cursor/fight.gif','cursor-fight.png'),(OBJ/'ui/cursor/dianji.gif','cursor-hand.png')]:
    if source.exists():Image.open(source).convert('RGBA').save(DEST/target)
support=Path('D:/333/zs.png')
if support.exists():shutil.copy2(support,DEST/'support.png')

b=(RES/'map/bun06_8.map').read_bytes(); header=struct.unpack_from('<5i',b)
layers=struct.unpack_from('<585i',b,20)
data={'id':'bun06_8','name':'抢包山 6','width':15,'height':13,'tileSize':40,
      'nativeHeader':list(header),'build':'5.2 reference resources',
      'structures':list(layers[:195]),'blocks':list(layers[195:390]),'ground':list(layers[390:]),
      'spawns':[],
      'bases':[{'team':0,'x':4,'y':1,'w':3,'h':3,'doorX':5,'doorY':4},
               {'team':1,'x':8,'y':1,'w':3,'h':3,'doorX':9,'doorY':4}]}
at=20+3*195*4
# Tail: reserved int, destructible-cell count + uint16(row,col) list, then team spawns.
_,count=struct.unpack_from('<2i',b,at); at+=8+count*4
for team in range(2):
    count=struct.unpack_from('<i',b,at)[0];at+=4
    for i in range(count):
        row,col=struct.unpack_from('<2H',b,at);at+=4;data['spawns'].append([col,row])
(DEST/'map.json').write_text(json.dumps(data,ensure_ascii=False),encoding='utf8')
(DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf8')
(DEST/'SOURCE.txt').write_text('Imported from user-provided D:/333/QQtang. Original QQ Tang graphics and audio belong to their original rights holders.\nMap: BOSS单机版/BOSS单机版m1/resources/map/bun06_8.map\nRed Sea Prince is composed from original character layers. Blue uses a derived team palette.\n',encoding='utf8')
print(f'Imported {len(manifest)} sprites to {DEST}')
