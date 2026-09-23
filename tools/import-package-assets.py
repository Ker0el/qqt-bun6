"""Read selected DIMG artwork from a verified QQTang-Local release archive.
Format details cross-checked against kuuhaku1314/qqtang (Apache-2.0),
internal/game/itemcatalog/archive.go and dimg.go. Does not execute client code.
"""
from pathlib import Path
from zipfile import ZipFile
from PIL import Image
import struct,zlib,json,hashlib

ROOT=Path(__file__).resolve().parents[1]
ZIP=ROOT.parents[1]/'work/qqtang-release/QQTang-Local.zip'
EXPECTED='ab2332193ea75ac8c266ae97c9fe9c086b5a9cfc0a5fb4428bb70fec0c375cfd'
assert hashlib.sha256(ZIP.read_bytes()).hexdigest()==EXPECTED
PREFIX='QQTang-Local/runtime/client-patched/'

def decode(data):
    assert data[:8]==b'QQF\x1aDIMG'
    version,info,n,dirs=struct.unpack_from('<4I',data,8)
    origin_x,origin_y,w,h=struct.unpack_from('<iiII',data,24)
    assert version in (65536,65537) and info==24 and 0<n<=1024 and n%dirs==0 and max(w,h)<=4096
    at=40;frames=[]
    for _ in range(n):
        magic,x,y,mode=struct.unpack_from('<IiiI',data,at);at+=16;assert magic==0
        im=Image.new('RGBA',(w,h))
        if mode:
            fw,fh,_=struct.unpack_from('<3I',data,at);at+=12
            assert max(fw,fh)<=4096
            count=fw*fh;bpp=4 if mode==8 else 3
            raw=data[at:at+count*bpp];at+=count*bpp;assert len(raw)==count*bpp
            pixels=[]
            for i in range(count):
                if mode in (3,0x11000000):
                    c=struct.unpack_from('<H',raw,i*2)[0];a=min(32,raw[count*2+i]);pixels.append((((c>>11)&31)*255//31,((c>>5)&63)*255//63,(c&31)*255//31,(a*255+16)//32))
                elif mode==8:pixels.append((raw[i*4+2],raw[i*4+1],raw[i*4],raw[i*4+3]))
                elif mode==16:pixels.append((raw[i*3+2],raw[i*3+1],raw[i*3],255))
                else:raise ValueError(f'Unsupported pixel mode {mode}')
            if count:
                frame=Image.new('RGBA',(fw,fh));frame.putdata(pixels);im.alpha_composite(frame,(x-origin_x,y-origin_y))
        frames.append(im)
    return frames,w,h,origin_x,origin_y

z=ZipFile(ZIP);idx=z.read(PREFIX+'data/object.idx');pkg=z.read(PREFIX+'data/object.pkg')
version,count,at,size=struct.unpack_from('<4I',idx);assert version==100 and at==16 and at+size==len(idx)
entries={}
for _ in range(count):
    n=struct.unpack_from('<H',idx,at)[0];at+=2;name=idx[at:at+n].decode('gbk').lower().replace('\\','/');at+=n
    entries[name]=struct.unpack_from('<4I',idx,at);at+=16
dest=ROOT/'public/assets';manifest=json.loads((dest/'manifest.json').read_text(encoding='utf8'))
selected={key:f'object/magic/magic{num:04}.img' for key,num in [('ready-original',135),('go-original',136),('ready-streak',137)]}
selected.update({'trap-bubble':'object/misc/misc111_stand.img','trap-shell':'object/misc/misc111_trigger.img','trap-pop':'object/misc/misc111_die.img'})
for key,name in selected.items():
    _,offset,size,compressed=entries[name]
    data=zlib.decompress(pkg[offset:offset+compressed]);assert len(data)==size
    frames,w,h,ox,oy=decode(data);atlas=Image.new('RGBA',(w*len(frames),h))
    for i,frame in enumerate(frames):atlas.alpha_composite(frame,(w*i,0))
    atlas.save(dest/f'{key}.png');manifest[key]={'src':f'/assets/{key}.png','w':w,'h':h,'frames':len(frames),'duration':100,'offsetX':ox,'offsetY':oy}
    print(key,w,h,len(frames))
(dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf8')
