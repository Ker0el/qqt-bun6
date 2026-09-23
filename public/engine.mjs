// Authoritative, deterministic gameplay. Distances are map cells, times seconds.
// Timing constants are research-derived calibration values, not recovered original code.
export const RULES = Object.freeze({ tick: 1 / 120, round: 240, fuse: 3.001,
  flame: .5, trap: 5, respawn: 10, shield: 2, speed: 5, maxSpeed: 8,
  carrySpeed: 2.4, capacity: 2, maxCapacity: 6, power: 1, maxPower: 7, phaseStart: .42, phaseEnd: .82,
  phaseDuration: .15, radius: 19/40, cornerTolerance: 6/40, maxPlayers: 8 });
export const DIR = { right: [1, 0, 0], up: [0, -1, 1], left: [-1, 0, 2], down: [0, 1, 3] };
export const cell = (x, y) => `${x},${y}`;

// 快照补齐用的规范玩家形状。借用原型调用 makePlayer，避免模块级时序与地图依赖。
let _playerShape = null;
export function playerDefaults() {
  if (_playerShape) return _playerShape;
  const p = Object.create(Match.prototype).makePlayer('', '', 0);
  _playerShape = {};
  for (const k of Object.keys(p)) if (!['input', 'actions', 'passes', 'wallPasses'].includes(k)) _playerShape[k] = p[k];
  return _playerShape;
}
// 把 Match.compact() 省略掉的字段按默认值补回，客户端与测试共用
export function hydratePlayers(players) {
  if (!players) return players;
  const d = playerDefaults();
  for (const p of players) for (const k in d) if (p[k] === undefined) p[k] = d[k];
  return players;
}
// Native leading edge is +/-19 px. The sprite anchor (50,64) puts its feet
// at the bottom of that grid cell; every imported frame fits these bounds.
export const ARENA_BOUNDS = Object.freeze({ left: .5, right: 14.5, top: .5, bottom: 12.5 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const destructive = id => id >= 8001 && id <= 8004;

export class Match {
  constructor(map, practice = false, seed = 12345) {
    this.map = map; this.practice = practice; this.seed = seed >>> 0;
    this.time = 0; this.state = 'lobby'; this.players = [];
    this.blocks = [...map.blocks]; this.bombs = []; this.flames = []; this.items = [];this.hiddenItems=[];
    this.buns = []; this.stored = [[3,0],[0,3]]; this.stock = [3, 3]; this.totalBuns = 6; this.events = []; this.serial = 0;
    this.countdown = 0; this.remaining = RULES.round; this.winner = null;
    this.drill = null;this.rubble=new Map();
    this.rev = { blocks: 0 }; this.lastBlocksRevision = -1;
  }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  event(type, data = {}) { this.events.push({ id: ++this.serial, type, time: this.time, ...data }); this.events = this.events.slice(-50); }
  setBlock(x, y, value) { this.blocks[y * 15 + x] = value; this.rev.blocks++; }
  // 快照压缩：省略空值/默认值字段，可省掉约一半体积。
  // 客户端必须按同样的默认值补齐（见 app.mjs 的 hydrate），否则 undefined 会让
  // `carry !== null` 之类的判断失真。
  static compact(o) {
    const out = {};
    for (const k in o) {
      const v = o[k];
      if (v === null || v === undefined || v === false || v === '') continue;
      if (Array.isArray(v)) { if (v.length) out[k] = v; continue; }
      if (typeof v === 'object') { const c = Match.compact(v); if (Object.keys(c).length) out[k] = c; continue; }
      out[k] = v;
    }
    return out;
  }
  // 玩家对象的唯一构造入口：addPlayer 与快照补齐共用，避免两处默认值漂移
  makePlayer(id, name, team) {
    return { id, name, team, ready: false, x: 0, y: 0, dir: 'down', moving: false,
      input: { dir: null }, actions: [], status: 'alive', speed: RULES.speed,
      capacity: RULES.capacity, power: RULES.power, carry: null,
      trappedUntil: 0, respawnAt: 0, shieldUntil: 0, phaseUntil: 0,
      activation: null, passes: [], wallPasses: [], onWall: null,
      captures: 0, kills: 0, deaths: 0, phaseCount: 0, wallCount: 0,
      inHouse: null, skin: 'classic',mods:{bombs:false,speed:false,power:false,invincible:false,noclip:false,reveal:false},lastBomb: -10, lastSequence: -1 };
  }
  addPlayer(id, name, team) {
    const p = this.makePlayer(id, name, team);
    this.players.push(p); this.spawn(p); return p;
  }
  spawn(p) {
    const same = this.players.filter(x => x.team === p.team);
    const start = same.indexOf(p) % 4 + p.team * 4;
    const possible = [this.map.spawns[start], ...this.map.spawns.filter((_, i) => Math.floor(i / 4) === p.team)];
    const spot = possible.find(([x, y]) => !this.bombAt(x, y) && !this.flameAt(x, y)) || possible[0];
    p.x = spot[0] + .5; p.y = spot[1] + .5; p.dir = 'down';
    p.status = 'alive'; p.shieldUntil = this.time + RULES.shield;
    p.slideDir=null;p.slideInput=null;p.slowUntil=0;p.forks=0;p.bananas=0;p.smiles=0;
    p.activation = null; p.passes = []; p.wallPasses = []; p.onWall = null;
    p.phaseUntil = 0; p.input = { dir: null }; p.actions = []; p.moving = false;
    p.inHouse = null;p.recentActivation=null;p.releasePending=false;p.inputChangedAt=-1;p.renderLayer='ground';p.renderWallCell=null;
  }
  removePlayer(id) {
    const p = this.players.find(p => p.id === id); if (p) this.dropBun(p);
    this.players = this.players.filter(p => p.id !== id);
    if (!this.practice && ['playing', 'countdown'].includes(this.state)) {
      const sides = [0, 1].map(team => this.players.some(p => p.team === team));
      if (sides[0] !== sides[1]) this.finish(sides[0] ? 0 : 1, '对方已离开');
    }
  }
  start() {
    this.autoWin=null;
    this.rubble.clear();
    this.time = 0; this.blocks = [...this.map.blocks]; this.bombs = []; this.flames = [];
    this.rev.blocks++; // 开局重建地图，必须让客户端重新拿到 blocks
    this.items = []; this.buns = []; this.stored=[[3,0],[0,3]]; this.stock=[3,3];this.totalBuns=6;this.remaining=RULES.round;
    this.hiddenItems=[];
    for(const p of this.players)p.collected={capacity:0,power:0,speed:0};
    for(let y=0;y<13;y++)for(let x=0;x<15;x++)if(destructive(this.blockAt(x,y))){
      const roll=this.random();
      const kind=roll<.24?'capacity':roll<.36?'power':roll<.60?'speed':roll<.62?'fork':roll<.66?'banana':roll<.70?'smile':null;
      if(kind)this.hiddenItems.push({id:++this.serial,x,y,kind});
    }
    this.winner = null; this.reason = ''; this.events = []; this.drill = null;
    this.state = 'countdown'; this.countdown = 3;
    for (const p of this.players) {
      Object.assign(p, { carry: null, captures: 0, deaths: 0, kills: 0, phaseCount: 0, wallCount: 0,
        power: RULES.power, capacity: RULES.capacity, speed: RULES.speed, lastBomb: -10 });
      this.spawn(p);
    }
    this.event('start');
  }
  setInput(id, data) {
    const p = this.players.find(p => p.id === id); if (!p) return;
    if (!Number.isSafeInteger(data.seq) || data.seq <= p.lastSequence) return;
    p.lastSequence = data.seq;
    if(p.slideDir){p.slideInput=Object.hasOwn(DIR,data.dir)?data.dir:null;p.input.dir=null;p.actions=[];return;}
    const dir = Object.hasOwn(DIR, data.dir) ? data.dir : null;
    if(dir&&p.input.dir===null&&p.activation&&this.time-p.activation.since>RULES.phaseEnd){p.activation=null;p.recentActivation=null;}
    if (dir !== p.input.dir && dir) {
      if (p.activation && dir !== p.activation.dir) p.recentActivation={...p.activation,lastSeen:this.time};
    }
    if(dir===null&&p.input.dir&&p.inputChangedAt===this.time)p.releasePending=true;
    else{p.input.dir=dir;p.releasePending=false;p.inputChangedAt=this.time;}
    if (data.bomb === true && p.actions.length < 4) p.actions.push('bomb');
  }
  blockAt(x, y) { return x < 0 || y < 0 || x >= 15 || y >= 13 ? -1 : this.blocks[y * 15 + x]; }
  structureAt(x, y) { return x < 0 || y < 0 || x >= 15 || y >= 13 ? -1 : this.map.structures[y * 15 + x]; }
  bombAt(x, y) { return this.bombs.find(b => b.x === x && b.y === y); }
  flameAt(x, y) { return this.flames.find(f => f.x === x && f.y === y); }
  overlaps(p, x, y, r = RULES.radius) { return Math.abs(p.x - x - .5) < .5 + r && Math.abs(p.y - y - .5) < .5 + r; }
  houseCornerAt(x,y) { return this.map.bases.some(b=>(x===b.x||x===b.x+b.w-1)&&(y===b.y||y===b.y+b.h-1)); }
  rubbleAt(x,y){return (this.rubble.get(cell(x,y))||0)>this.time;}
  solid(x, y) { return !!this.blockAt(x, y) || this.houseCornerAt(x,y)||this.rubbleAt(x,y); }
  canStand(p, x, y) {
    const r = RULES.radius;
    if (x < ARENA_BOUNDS.left || y < ARENA_BOUNDS.top || x > ARENA_BOUNDS.right || y > ARENA_BOUNDS.bottom) return false;
    if(this.trainingEnabled(p,'noclip'))return true;
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        if(this.houseCornerAt(cx,cy)||this.rubbleAt(cx,cy))return false;
        if (this.blockAt(cx, cy) && !p.wallPasses.includes(cell(cx, cy)) && p.onWall !== cell(cx, cy)) return false;
        const b = this.bombAt(cx, cy);
        if (b && !p.passes.includes(b.id)) return false;
      }
    }
    return true;
  }
  leadingCollisions(p,x,y,dir){
    const r=RULES.radius,[dx,dy]=DIR[dir];
    const points=dx?[[x+dx*r,y-r],[x+dx*r,y+r]]:[[x-r,y+dy*r],[x+r,y+dy*r]];
    return points.map(([px,py])=>{
      const cx=Math.floor(px),cy=Math.floor(py),b=this.bombAt(cx,cy);
      const blocked=this.houseCornerAt(cx,cy)||this.rubbleAt(cx,cy)||
        (!!this.blockAt(cx,cy)&&!p.wallPasses.includes(cell(cx,cy))&&p.onWall!==cell(cx,cy))||
        (!!b&&!p.passes.includes(b.id));
      return {cx,cy,blocked,dynamic:!!b&&!p.passes.includes(b.id)};
    });
  }
  canMove(p,x,y,dir){
    if(x<ARENA_BOUNDS.left||x>ARENA_BOUNDS.right||y<ARENA_BOUNDS.top||y>ARENA_BOUNDS.bottom)return false;
    if(this.trainingEnabled(p,'noclip'))return true;
    return this.leadingCollisions(p,x,y,dir).every(c=>!c.blocked);
  }
  slideCorner(p,nx,ny,dir,dist){
    const corners=this.leadingCollisions(p,nx,ny,dir);
    if(corners[0].blocked===corners[1].blocked)return false;
    const free=corners.find(c=>!c.blocked),[dx]=DIR[dir];
    const coordinate=dx?p.y:p.x,target=(dx?free.cy:free.cx)+.5;
    const dynamic=corners.some(c=>c.dynamic);
    // Bubbles only guide near-edge movement; the central approach stays steady for phasing.
    if(Math.abs(target-coordinate)>(dynamic?.45:.65))return false;
    const slideDist=dist*.8;
    const delta=clamp(target-coordinate,-slideDist,slideDist);if(!delta)return false;
    const side=dx?(delta<0?'up':'down'):(delta<0?'left':'right');
    const x=p.x+(dx?0:delta),y=p.y+(dx?delta:0);
    if(!this.canMove(p,x,y,side))return false;
    p.x=x;p.y=y;p.moving=true;return true;
  }
  findActivation(p) {
    const facing=p.input.dir||(p.activation?.dir===p.dir?p.dir:null);
    if (!facing || p.carry !== null || p.onWall) return null;
    const [dx, dy] = DIR[facing];
    // Look ahead along the movement ray. Run-up timing begins before contact;
    // its distance scales with speed rather than requiring a stationary hug.
    const reach=p.speed*.6+1;
    const candidates = this.bombs.map(b => {
      const vx = b.x + .5 - p.x, vy = b.y + .5 - p.y;
      return { b, forward: vx * dx + vy * dy, lateral: vx * -dy + vy * dx };
    }).filter(a => a.forward > .18 && a.forward <= reach && Math.abs(a.lateral) < .7)
      .sort((a, b) => a.forward - b.forward);
    for (const c of candidates) {
      let clear=true;
      for(let d=.5;d<c.forward-.6;d+=.25){if(this.solid(Math.floor(p.x+dx*d),Math.floor(p.y+dy*d))){clear=false;break}}
      if(!clear)continue;
      const wall=this.bubbleSupport(p,c.b,facing,reach);
      if (Math.abs(c.lateral) < .2 || wall) return { id:c.b.id,dir:facing,wall };
    }
    return null;
  }
  bubbleSupport(p,b,dir,reach=1.5){
    const[dx,dy]=DIR[dir],forward=(b.x+.5-p.x)*dx+(b.y+.5-p.y)*dy;
    if(forward<.18||forward>reach)return null;
    const candidates=dx?[[b.x,b.y-1],[b.x,b.y+1]]:[[b.x-1,b.y],[b.x+1,b.y]];
    for(const[x,y]of candidates){
      if(this.blockAt(x,y)<=0||this.houseCornerAt(x,y)||this.solid(x+dx,y+dy))continue;
      const boundary=dx?(y+b.y+1)/2:(x+b.x+1)/2,coordinate=dx?p.y:p.x;
      if(Math.abs(coordinate-boundary)<=RULES.radius+.05)return{x,y,dir};
    }
    return null;
  }
  attemptPhase(p) {
    const choices=[p.activation,p.recentActivation].filter(a=>a&&this.time-(a.lastSeen??this.time)<.12);
    const a=choices.find(a=>this.time-a.since>=RULES.phaseStart&&this.time-a.since<=RULES.phaseEnd)||choices[0];
    if (!a) return false;
    const elapsed = this.time - a.since;
    if (elapsed < RULES.phaseStart - 1e-6 || elapsed > RULES.phaseEnd + 1e-6) {
      if (this.practice) this.event('timing', { player: p.id, elapsed, success: false });
      return false;
    }
    const target = this.bombs.find(b => b.id === a.id); if (!target) return false;
    const [dx, dy] = DIR[a.dir];
    // No phasing through two stacked bombs or through a solid landing cell.
    if (!a.wall && (this.solid(target.x + dx, target.y + dy) || this.bombAt(target.x + dx, target.y + dy))) return false;
    // One cell of travel plus a small input tolerance; fast actors get a
    // shorter physical pass, rather than a speed-independent fixed timer.
    p.phaseUntil = this.time + 1/p.speed+.04;
    p.phaseDir = a.dir;
    p.phaseCount++;
    p.passes.push(target.id);
    if (a.wall) {
      p.wallPasses.push(cell(a.wall.x, a.wall.y));
      p.mountTarget = { ...a.wall }; p.wallCount++;
    }
    this.event(a.wall ? 'wall' : 'phase', { player: p.id, x: p.x, y: p.y, elapsed });
    p.activation = null;p.recentActivation=null;
    return true;
  }
  transferPhase(p) {
    if (this.time >= p.phaseUntil || !p.input.dir || p.mountTarget || p.onWall) return;
    const [dx,dy] = DIR[p.input.dir];
    for (const b of this.bombs) {
      const forward = (b.x + .5 - p.x) * dx + (b.y + .5 - p.y) * dy;
      const lateral = dx ? p.y - b.y - .5 : p.x - b.x - .5;
      if (forward < .18 || forward > 1.18) continue;
      // Acquired phase can be transferred to another single bubble after turning.
      if (Math.abs(lateral) < .18 && !this.solid(b.x+dx,b.y+dy) && !this.bombAt(b.x+dx,b.y+dy)) {
        if (!p.passes.includes(b.id)) p.passes.push(b.id);
      }
      const support=this.bubbleSupport(p,b,p.input.dir);
      if(support){
          const key=cell(support.x,support.y);
          if (!p.wallPasses.includes(key)) {
            p.wallPasses.push(key);p.passes.push(b.id);p.mountTarget=support;p.wallCount++;
            this.event('wall', { player:p.id,x:p.x,y:p.y,elapsed:0,technique:'3p' });
          }
          return;
      }
    }
  }
  placeBomb(p) {
    if(p.slideDir)return false;
    const unlimited=this.trainingEnabled(p,'bombs');
    if (p.status !== 'alive' || p.carry !== null || this.time - p.lastBomb < (unlimited?.035:.12)) return false;
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (this.solid(x, y) || this.bombAt(x, y) || this.bombs.filter(b => b.owner === p.id).length >= (unlimited?195:p.capacity)) return false;
    this.attemptPhase(p);
    const b = { id: ++this.serial, x, y, owner: p.id, team: p.team, skin:p.skin, power:this.trainingEnabled(p,'power')?32:p.power, born: this.time, explodeAt: this.time + RULES.fuse };
    this.bombs.push(b); p.lastBomb = this.time;
    b.livePower=true;
    for (const other of this.players) if (this.overlaps(other, x, y)) other.passes.push(b.id);
    this.event('bomb', { x, y, player: p.id }); return true;
  }
  move(p, dt) {
    p.moving = false;
    if (p.status !== 'alive') return;
    this.transferPhase(p);
    const activation = p.slideDir?null:this.findActivation(p);
    if (activation) {
      if (!p.activation || p.activation.id !== activation.id || p.activation.dir !== activation.dir){
        if(p.activation)p.recentActivation={...p.activation};
        p.activation={...activation,since:this.time,lastSeen:this.time};
      }else{p.activation.wall=activation.wall;p.activation.lastSeen=this.time;}
    } else if(p.activation&&this.time-(p.activation.lastSeen??0)>.1){p.recentActivation={...p.activation};p.activation=null;}
    if (p.slideDir||p.input.dir) {
      p.dir = p.slideDir||p.input.dir;
      const [dx, dy] = DIR[p.dir];
      const speed=this.trainingEnabled(p,'speed')?60:p.carry===null?p.speed:RULES.carrySpeed;
      const dist = (p.slideDir?10:speed*(p.slowUntil>this.time?.3:1)) * dt;
      const nx = clamp(p.x + dx * dist, ARENA_BOUNDS.left, ARENA_BOUNDS.right);
      const ny = clamp(p.y + dy * dist, ARENA_BOUNDS.top, ARENA_BOUNDS.bottom);
      let slideEnded=false;
      if (this.canMove(p, nx, ny,p.dir)) { p.moving = nx !== p.x || ny !== p.y; p.x = nx; p.y = ny; }
      else if(p.slideDir){
        // Finish the remaining partial step up to contact before unlocking input.
        let low=0,high=dist;
        for(let i=0;i<16;i++){const mid=(low+high)/2;if(this.canMove(p,p.x+dx*mid,p.y+dy*mid,p.dir))low=mid;else high=mid;}
        p.x+=dx*low;p.y+=dy*low;p.moving=low>1e-6;slideEnded=true;
      }
      else if (!p.slideDir&&!p.activation?.wall && !p.onWall) this.slideCorner(p,nx,ny,p.dir,dist);
      if(p.slideDir&&(slideEnded||!p.moving||(dx<0&&p.x===ARENA_BOUNDS.left)||(dx>0&&p.x===ARENA_BOUNDS.right)||(dy<0&&p.y===ARENA_BOUNDS.top)||(dy>0&&p.y===ARENA_BOUNDS.bottom))){p.slideDir=null;p.input.dir=p.slideInput??null;p.slideInput=null;}
    }
    // Keep permission only while leaving a bubble/wall, never grant general noclip.
    p.passes = p.passes.filter(id => {
      const b = this.bombs.find(b => b.id === id);
      return b && (this.overlaps(p, b.x, b.y) || this.time < p.phaseUntil);
    });
    if (p.mountTarget && this.time < p.phaseUntil && this.overlaps(p, p.mountTarget.x, p.mountTarget.y)) {
      // The short offset phase seats the character inside this single wall cell.
      const wall = p.mountTarget;
      const[dx]=DIR[wall.dir||p.phaseDir||p.dir];
      if(dx)p.y+=clamp(wall.y+.5-p.y,-p.speed*dt,p.speed*dt);
      else p.x += clamp(wall.x + .5 - p.x, -p.speed * dt, p.speed * dt);
      if (Math.floor(p.y) === wall.y && Math.floor(p.x)===wall.x && Math.abs((dx?p.y:p.x)-(dx?wall.y:wall.x)-.5)<.26) {
        p.onWall = cell(wall.x, wall.y); p.mountTarget = null;
      }
    }
    if (p.mountTarget && this.time > p.phaseUntil && !p.onWall) p.mountTarget = null;
    if (p.onWall) {
      const [wx, wy] = p.onWall.split(',').map(Number);
      if (!this.overlaps(p, wx, wy) || !this.blockAt(wx, wy)) p.onWall = null;
    }
    p.wallPasses = p.wallPasses.filter(k => {
      const [x, y] = k.split(',').map(Number);
      return this.time < p.phaseUntil || this.overlaps(p, x, y);
    });
    p.x = clamp(p.x, ARENA_BOUNDS.left, ARENA_BOUNDS.right);
    p.y = clamp(p.y, ARENA_BOUNDS.top, ARENA_BOUNDS.bottom);
    this.updateHouseState(p);
    this.syncRenderLayer(p);
    // Animation follows held movement intent even when collision stops displacement.
    p.moving=!!(p.slideDir||p.input.dir);
    if(p.releasePending){p.input.dir=null;p.releasePending=false;}
  }
  updateHouseState(p) {
    const base=this.map.bases.find(b=>p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.h);
    const next=base?.team??null;
    if(next!==p.inHouse){
      const previous=p.inHouse;p.inHouse=next;p.activation=null;
      this.event(next===null?'leave-house':'enter-house',{player:p.id,team:next??previous});
    }
  }
  syncRenderLayer(p){
    const x=Math.floor(p.x),y=Math.floor(p.y),key=cell(x,y),wall=this.blockAt(x,y)>0;
    const allowed=p.wallPasses.includes(key)||p.onWall===key||this.trainingEnabled(p,'noclip');
    if(p.status==='dead'){p.renderLayer='ground';p.renderWallCell=null;p.onWall=null;return;}
    if(wall&&allowed){
      p.renderLayer='wall';p.renderWallCell=key;
      if(!this.trainingEnabled(p,'noclip'))p.onWall=key;
      return;
    }
    if(p.mountTarget&&this.time<p.phaseUntil&&this.blockAt(p.mountTarget.x,p.mountTarget.y)>0&&this.overlaps(p,p.mountTarget.x,p.mountTarget.y)){
      p.renderLayer='wall';p.renderWallCell=cell(p.mountTarget.x,p.mountTarget.y);return;
    }
    p.renderLayer='ground';p.renderWallCell=null;if(!wall)p.onWall=null;
  }
  blastCoverage(p,cells){
    const r=RULES.radius;let area=0;
    for(const c of cells){const w=Math.max(0,Math.min(p.x+r,c.x+1)-Math.max(p.x-r,c.x));const h=Math.max(0,Math.min(p.y+r,c.y+1)-Math.max(p.y-r,c.y));area+=w*h;}
    return area/(4*r*r);
  }
  explode(bomb) {
    if (!this.bombs.includes(bomb)) return;
    const owner=this.players.find(p=>p.id===bomb.owner);
    if(bomb.livePower&&owner)bomb.power=this.trainingEnabled(owner,'power')?32:owner.power;
    this.bombs = this.bombs.filter(b => b.id !== bomb.id);
    const affected = [{ x: bomb.x, y: bomb.y, arm: 'center', end: false }];
    for (const [name, [dx, dy]] of Object.entries(DIR)) {
      for (let n = 1; n <= bomb.power; n++) {
        const x = bomb.x + dx * n, y = bomb.y + dy * n;
        const block = this.blockAt(x, y);
        if (this.houseCornerAt(x,y) || block === -1 || (block && !destructive(block))) break;
        affected.push({ x, y, arm: name, end: n === bomb.power });
        if (block) {
          this.setBlock(x, y, 0);
          this.rubble.set(cell(x,y),this.time+.2);
          this.event('break', { x, y, tile: block - 8000 });
          const buried=this.hiddenItems.find(i=>i.x===x&&i.y===y);
          if(buried){this.hiddenItems=this.hiddenItems.filter(i=>i!==buried);this.items.push({...buried,availableAt:this.time+RULES.flame});}
          break;
        }
        const chained = this.bombAt(x, y);
        if (chained) { this.explode(chained); break; }
      }
    }
    // A ray ends at its last included cell even if a wall stopped it early.
    for (const name of Object.keys(DIR)) {
      const arm = affected.filter(f => f.arm === name);
      if (arm.length) arm.at(-1).end = true;
    }
    for (const f of affected) {
      const visual={...f,id:++this.serial,born:this.time,until:this.time+RULES.flame,owner:bomb.owner};
      const existing=this.flames.findIndex(old=>old.x===f.x&&old.y===f.y);
      if(existing>=0)this.flames[existing]=visual;else this.flames.push(visual);
    }
    this.items=this.items.filter(i=>(i.availableAt??0)>this.time||!affected.some(f=>f.x===i.x&&f.y===i.y));
    // Native damage is a single explosion impact. The remaining flame lifetime
    // is animation only: walking through a freshly destroyed wall is safe.
    for(const p of this.players){
      if(p.status!=='alive'||p.shieldUntil>=this.time||this.trainingEnabled(p,'invincible'))continue;
      if(this.blastCoverage(p,affected)>.52+1e-7)this.trapPlayer(p,bomb.owner);
    }
    this.event('explode', { x: bomb.x, y: bomb.y });
  }
  trapPlayer(p,owner){
    if(this.trainingEnabled(p,'invincible'))return;
    p.status='trapped';p.trappedUntil=this.time+RULES.trap;p.trappedBy=owner;
    p.moving=false;p.activation=null;this.dropBun(p);this.event('trap',{player:p.id});
  }
  dropBun(p) {
    if (p.carry === null) return;
    this.buns.push({ id: ++this.serial, owner: p.carry, x: Math.floor(p.x), y: Math.floor(p.y) });
    p.carry = null;
  }
  kill(p, killer = null) {
    if(this.trainingEnabled(p,'invincible'))return;
    if (p.status === 'dead') return;
    this.dropBun(p); p.status = 'dead'; p.deaths++; p.respawnAt = this.time + RULES.respawn;
    this.scatterUpgrades(p);
    p.forks=0;p.bananas=0;p.smiles=0;
    p.activation = null; p.input.dir = null; p.actions = [];
    const other = this.players.find(q => q.id === killer && q.team !== p.team);
    if (other) other.kills++;
    this.event('death', { player: p.id, x: p.x, y: p.y });
  }
  objectives(p) {
    if (p.status !== 'alive') return;
    const x = Math.floor(p.x), y = Math.floor(p.y);
    const item = this.items.find(i => i.x === x && i.y === y && i.availableAt <= this.time&&i.ignoreOwner!==p.id);
    if (item) {
      this.items = this.items.filter(i => i !== item);this.collectItem(p,item);
    }
    if(this.trainingEnabled(p,'noclip')&&this.blockAt(x,y)>0){
      const buried=this.hiddenItems.find(i=>i.x===x&&i.y===y);
      if(buried){this.hiddenItems=this.hiddenItems.filter(i=>i!==buried);this.collectItem(p,buried);}
    }
    for (const bun of [...this.buns]) {
      if (bun.x !== x || bun.y !== y) continue;
      // Both friendly and enemy dropped buns must be carried back, not auto-returned.
      if (p.carry === null) {
        p.carry = bun.owner; this.buns = this.buns.filter(b => b !== bun);
        this.event('recover', { player: p.id, team: p.team, own: bun.owner === p.team });
      }
    }
    for (const base of this.map.bases) {
      if (p.inHouse !== base.team) continue;
      if (base.team !== p.team && p.carry === null && this.stored[base.team][base.team] > 0) {
        this.stored[base.team][base.team]--; this.syncStock();p.carry = base.team; p.activation = null;
        this.event('steal', { player: p.id, team: p.team });
      } else if (base.team === p.team && p.carry !== null) {
        const own = p.carry === p.team;
        this.stored[p.team][p.carry]++;this.syncStock();p.carry = null; if (!own) p.captures++;
        this.event(own ? 'return-bun' : 'capture', { player: p.id, team: p.team });
        if (this.stored[p.team][1-p.team] >= 3) this.finish(p.team, '对方三个包子全部带回！');
      }
    }
  }
  syncStock(){this.stock=this.stored.map(row=>row[0]+row[1]);}
  collectItem(p,item){
    if(['capacity','power','speed'].includes(item.kind)){
      p.collected??={capacity:0,power:0,speed:0};p.collected[item.kind]++;
    }
    if(item.kind==='fork')p.forks=(p.forks||0)+1;
    if(item.kind==='banana')p.bananas=(p.bananas||0)+1;
    if(item.kind==='banana-trap'){
      p.slideDir=p.slideDir||p.input.dir||p.dir;
      p.slideInput=p.input.dir;p.input.dir=null;p.actions=[];p.activation=null;p.recentActivation=null;
    }
    if(item.kind==='smile')p.smiles=(p.smiles||0)+1;
    if(item.kind==='smile-trap')p.slowUntil=this.time+5;
    if(item.kind==='capacity')p.capacity=Math.min(RULES.maxCapacity,p.capacity+1);
    if(item.kind==='power')p.power=Math.min(RULES.maxPower,p.power+1);
    if(item.kind==='speed')p.speed=Math.min(RULES.maxSpeed,p.speed+1);
    this.event('pickup',{player:p.id,kind:item.kind});
  }
  useFork(id){
    const p=this.players.find(p=>p.id===id);
    if(this.state!=='playing'||!p||p.status!=='trapped'||!(p.forks>0))return false;
    p.forks--;p.status='alive';p.trappedUntil=0;p.trappedBy=null;
    p.shieldUntil=this.time-1;p.slideDir=null;p.actions=[];p.input.dir=null;
    this.event('rescue',{player:p.id});return true;
  }
  placeBanana(id){
    return this.placeTrap(id,'banana');
  }
  scatterUpgrades(p){
    const cells=[];
    for(let y=0;y<13;y++)for(let x=0;x<15;x++){
      if(this.solid(x,y)||this.bombAt(x,y)||this.flameAt(x,y)||this.items.some(i=>i.x===x&&i.y===y)||this.buns.some(i=>i.x===x&&i.y===y)||this.map.bases.some(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h))continue;
      cells.push({x,y});
    }
    for(let i=cells.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
    for(const kind of ['capacity','power','speed']){
      const count=p.collected?.[kind]??Math.max(0,p[kind]-RULES[kind]);
      for(let n=0;n<count&&cells.length;n++){
        const target=cells.pop(),duration=.65+Math.min(.3,Math.hypot(target.x+.5-p.x,target.y+.5-p.y)*.025);
        this.items.push({id:++this.serial,...target,kind,availableAt:this.time+duration,flight:{x:p.x,y:p.y,born:this.time,duration}});
      }
      p[kind]=RULES[kind];
    }
    p.collected={capacity:0,power:0,speed:0};
  }
  placeTrap(id,kind){
    if(!['banana','smile'].includes(kind))return false;
    const inventory=kind==='banana'?'bananas':'smiles';
    const p=this.players.find(p=>p.id===id);
    if(this.state!=='playing'||!p||p.status!=='alive'||p.slideDir||!(p[inventory]>0))return false;
    const x=Math.floor(p.x),y=Math.floor(p.y);
    if(this.solid(x,y)||this.bombAt(x,y)||this.items.some(i=>i.x===x&&i.y===y))return false;
    p[inventory]--;this.items.push({id:++this.serial,x,y,kind:`${kind}-trap`,availableAt:this.time,ignoreOwner:p.id});return true;
  }
  trainingEnabled(p,key){return this.practice&&this.players.length===1&&p.mods?.[key]===true;}
  setTrainingMod(id,key,value){
    if(!this.practice||this.players.length!==1||!['bombs','speed','power','invincible','noclip','reveal'].includes(key)||typeof value!=='boolean')return false;
    const p=this.players.find(p=>p.id===id);if(!p)return false;p.mods[key]=value;
    if(key==='invincible'&&value&&p.status!=='alive')this.spawn(p);
    if(key==='noclip'&&!value&&!this.canStand(p,p.x,p.y)){
      const choices=[];for(let y=0;y<13;y++)for(let x=0;x<15;x++)if(this.canStand(p,x+.5,y+.5))choices.push({x:x+.5,y:y+.5,d:Math.hypot(p.x-x-.5,p.y-y-.5)});
      choices.sort((a,b)=>a.d-b.d);if(choices[0]){p.x=choices[0].x;p.y=choices[0].y;this.updateHouseState(p)}
    }
    return true;
  }
  beginTrainingWin(id){
    if(!this.practice||this.players.length!==1)return false;
    const p=this.players.find(p=>p.id===id);if(!p)return false;
    if(this.state!=='playing')this.start();this.state='playing';this.countdown=0;
    this.stored=[[3,0],[0,3]];this.buns=[];this.syncStock();p.carry=null;p.captures=0;
    this.autoWin={id,nextAt:this.time,step:0};this.dropBun(p);p.status='alive';p.input.dir=null;return true;
  }
  tickTrainingWin(){
    const job=this.autoWin;if(!job||this.time<job.nextAt)return;
    const p=this.players.find(p=>p.id===job.id);if(!p){this.autoWin=null;return;}
    const team=job.step%2===0?1-p.team:p.team,base=this.map.bases.find(b=>b.team===team);
    const from={x:p.x,y:p.y};p.x=base.x+1.5;p.y=base.y+1.5;p.inHouse=team;p.onWall=null;
    p.status='alive';p.shieldUntil=this.time+2;p.warpUntil=this.time+.14;this.objectives(p);
    this.event('training-warp',{player:p.id,fromX:from.x,fromY:from.y,x:p.x,y:p.y});
    job.step++;job.nextAt=this.time+.16;
    if(this.stored[p.team][1-p.team]>=3){this.autoWin=null;if(this.state!=='finished')this.finish(p.team,'训练：对方三个包子已全部带回');}
    else if(job.step>=10){this.autoWin=null;this.event('training-win-unavailable',{player:p.id});}
  }
  finish(winner, reason = '时间到') { this.state = 'finished'; this.winner = winner; this.reason = reason; this.event('finish', { winner }); }
  setupDrill(id, mode) {
    if (!this.practice) return false;
    const p = this.players.find(p => p.id === id); if (!p) return false;
    this.start(); this.state = 'playing'; this.countdown = 0; this.drill = mode;
    if (mode === 'map') return true;
    if (mode === 'house') { p.x=5.5;p.y=4.5;p.dir='up';return true; }
    // Practice fixtures occupy the existing central courtyard; the actual match map stays intact.
    for (let y = 4; y <= 8; y++) for (let x = 3; x <= 11; x++) this.setBlock(x, y, 0);
    this.hiddenItems=this.hiddenItems.filter(i=>destructive(this.blockAt(i.x,i.y)));
    if (mode === 'wall3') {
      Object.assign(p,{x:7.5,y:7.5,dir:'right',shieldUntil:1e9,capacity:3});
      for(const [x,y]of [[8,7],[8,6]])this.bombs.push({id:++this.serial,x,y,owner:'practice',team:1,power:2,born:this.time,explodeAt:1e9});
      this.setBlock(7,6,8005);this.event('drill',{mode});return true;
    }
    Object.assign(p, { x: ['wall','pillar'].includes(mode) ? 7.04 : 7.5, y:mode==='run'?10.5:7.5, dir: 'up', shieldUntil: 1e9 });
    if(mode==='run')for(let y=7;y<=11;y++)this.setBlock(7,y,0);
    this.bombs.push({ id: ++this.serial, x: 7, y: 6, owner: 'practice', team: 1, power: 2, born: this.time, explodeAt: 1e9 });
    if (mode === 'wall') this.setBlock(6,6,8005);
    if (mode === 'pillar') this.setBlock(6,6,8006);
    this.event('drill', { mode }); return true;
  }
  tick(dt = RULES.tick) {
    this.time += dt;
    if (this.state === 'lobby' || this.state === 'finished') return;
    if(this.practice)this.tickTrainingWin();
    if(this.state==='finished')return;
    if (this.state === 'countdown') {
      this.countdown = Math.max(0, this.countdown - dt);
      for (const p of this.players) p.actions = [];
      if (this.countdown <= 1e-6) { this.state = 'playing'; this.event('go'); for (const p of this.players) p.shieldUntil = this.time + RULES.shield; }
      return;
    }
    if (!this.practice) {
      this.remaining = Math.max(0, this.remaining - dt);
      if (!this.remaining) { this.finish(this.stock[0] === this.stock[1] ? null : +(this.stock[1] > this.stock[0])); return; }
    }
    this.flames = this.flames.filter(f => f.until > this.time);
    for(const[k,until]of this.rubble)if(until<=this.time)this.rubble.delete(k);
    for (const b of [...this.bombs]) if (b.explodeAt <= this.time) this.explode(b);
    for (const p of this.players) {
      this.syncRenderLayer(p);
      if (p.status === 'dead') { if (this.time >= p.respawnAt) this.spawn(p); continue; }
      if (p.status === 'trapped') { if (this.time >= p.trappedUntil) this.kill(p, p.trappedBy); continue; }
      this.move(p, dt);
      for(const item of this.items)if(item.ignoreOwner===p.id&&(Math.floor(p.x)!==item.x||Math.floor(p.y)!==item.y))delete item.ignoreOwner;
      if (p.actions.shift() === 'bomb') this.placeBomb(p);
      this.objectives(p);
    }
    for (const trapped of this.players.filter(p => p.status === 'trapped')) {
      for (const rescuer of this.players.filter(p => p.status === 'alive')) {
        if (Math.hypot(rescuer.x - trapped.x, rescuer.y - trapped.y) < .52) {
          if (rescuer.team === trapped.team) {
            trapped.status = 'alive'; trapped.shieldUntil = this.time + 1; this.event('rescue', { player: trapped.id });
          } else this.kill(trapped, rescuer.id);
          break;
        }
      }
    }
  }
  snapshot() {
    // 砖块仅在变化时下发：这是快照里最大的静态字段，每帧重发会占掉约三成带宽
    const includeBlocks = this.rev.blocks !== this.lastBlocksRevision;
    if (includeBlocks) this.lastBlocksRevision = this.rev.blocks;
    return { time: this.time, state: this.state, practice: this.practice, drill: this.drill,
      remaining: this.remaining, countdown: this.countdown, winner: this.winner, reason: this.reason,
      stock: this.stock,stored:this.stored,captured:[this.stored[0][1],this.stored[1][0]],totalBuns:this.totalBuns,
      blocksRevision: this.rev.blocks, blocks: includeBlocks ? this.blocks : undefined,
      bombs: this.bombs, flames: this.flames,
      items: this.items,hiddenItems:this.players[0]&&this.trainingEnabled(this.players[0],'reveal')?this.hiddenItems.filter(i=>this.blockAt(i.x,i.y)>0):[],buns: this.buns, events: this.events.slice(-24),
      players: this.players.map(({ input, actions, lastSequence, passes, wallPasses, mountTarget, ...p }) => Match.compact(p)) };
  }
}
