import {Match,RULES,DIR} from './engine.mjs';

// Reconstructed sailor behaviour. Native catalog confirms role 32, HP 5,
// bomb capacity/power maxima 8/8 and slow-glue skills; AI timing is calibrated.
// HP runs at 10 here so it matches the original ten-frame monster health bar
// (misc191..misc201, one frame per point) that is drawn above the sailor's head.
export class WaterMatch extends Match {
  constructor(map,practice=false,seed=12345){
    super(map,practice,seed);
    this.boss=null;
    // PVE 困泡比 PVP 多 5 秒，让队友来得及在水手补刀前救人。
    this.trapDuration=RULES.trapPve;
    this.caveOccupants=new Set();
  }
  caveSideBlocked(fromX,toX,y,r=RULES.radius){
    if(fromX===toX)return false;
    return this.map.objects.filter(o=>o.id===5010).some(o=>{
      if(y+r<=o.y||y-r>=o.y+o.h)return false;
      if(fromX<o.x)return toX+r>o.x;
      if(fromX>=o.x+o.w)return toX-r<o.x+o.w;
      // A body straddling the doorway may correct inward even while its
      // trailing edge overlaps a side wall; never trap it in penetration.
      const centre=o.x+o.w/2;
      if(toX>=o.x&&toX<o.x+o.w&&Math.abs(toX-centre)<Math.abs(fromX-centre))return false;
      return toX-r<o.x||toX+r>o.x+o.w;
    });
  }
  canMove(p,x,y,dir){
    if(!this.trainingEnabled(p,'noclip')&&this.caveSideBlocked(p.x,x,y))return false;
    return super.canMove(p,x,y,dir);
  }
  move(p,dt){
    const dir=p.slideDir||p.input.dir;
    if(p.status==='alive'&&!p.slideDir&&!this.trainingEnabled(p,'noclip')&&(dir==='up'||dir==='down')){
      const hole=this.map.objects.find(o=>o.id===5010&&Math.abs(p.x-(o.x+o.w/2))<=.65&&
        (dir==='down'?p.y>=o.y-.8&&p.y<o.y+.5:p.y<=o.y+o.h+.8&&p.y>o.y+o.h-.5));
      if(hole){
        const target=hole.x+hole.w/2,delta=target-p.x;
        const step=Math.min(Math.abs(delta),p.speed*dt*.9),x=p.x+Math.sign(delta)*step;
        // Check real terrain and bubbles; doorway assistance never teleports through them.
        if(step>0&&super.canMove(p,x,p.y,delta>0?'right':'left'))p.x=x;
      }
    }
    super.move(p,dt);
  }
  slideCorner(p,nx,ny,dir,dist){
    if((dir==='left'||dir==='right')&&this.caveSideBlocked(p.x,nx,p.y)){
      const hole=this.map.objects.find(o=>o.id===5010&&p.x>=o.x-RULES.radius&&p.x<=o.x+o.w+RULES.radius&&p.y>o.y-RULES.radius&&p.y<o.y+o.h+RULES.radius);
      if(hole){
        const top=hole.y-RULES.radius,bottom=hole.y+hole.h+RULES.radius;
        const target=p.y<hole.y+.2?top:p.y>hole.y+hole.h-.2?bottom:null;
        if(target!==null){const y=p.y+Math.sign(target-p.y)*Math.min(Math.abs(target-p.y),dist);
          if(super.canMove(p,p.x,y,y<p.y?'up':'down')){p.y=y;p.moving=true;return true;}}
      }
    }
    return super.slideCorner(p,nx,ny,dir,dist);
  }
  blocksFlameEdge(x0,y0,x,y){
    return y0===y&&this.caveSideBlocked(x0+.5,x+.5,y+.5,0);
  }
  start(){
    super.start();this.remaining=1800;   // PVE 一局 30 分钟，比 PVP 的 RULES.round 宽裕
    for(const p of this.players)p.rewards={};
    const candidates=[];
    for(let y=0;y<13;y++)for(let x=0;x<15;x++)if(!this.solid(x,y))candidates.push({x:x+.5,y:y+.5});
    candidates.sort((a,b)=>Math.hypot(a.x-7.5,a.y-6.5)-Math.hypot(b.x-7.5,b.y-6.5));
    this.boss={id:'sailor',...candidates[0],hp:10,maxHp:10,dir:'down',moving:false,phase:'birth',phaseUntil:4.2,hurtUntil:0,nextBomb:4.5,nextGlue:13,path:[],thinkAt:0,born:this.time};
  }
  spawn(p){
    super.spawn(p);
    delete p.diedAt;
    const index=this.players.indexOf(p),spot=this.map.spawns[index%this.map.spawns.length];
    p.x=spot[0]+.5;p.y=spot[1]+.5;p.team=0;
  }
  removePlayer(id){this.players=this.players.filter(p=>p.id!==id);}
  kill(p,killer=null){const wasDead=p.status==='dead';super.kill(p,killer);if(p.status==='dead'){if(!wasDead)p.diedAt=this.time;p.respawnAt=1e9;}}
  setupDrill(id,mode){if(mode==='map'){this.start();return true;}return false;}
  beginTrainingWin(){return false;}
  finish(team,reason){super.finish(team,reason);}
  explode(bomb){
    const existed=this.bombs.includes(bomb);super.explode(bomb);
    const b=this.boss;
    if(!existed||!b||b.hp<=0||this.time<b.hurtUntil||b.phase==='birth')return;
    const blast=this.flames.filter(f=>f.born===this.time);
    if(this.blastCoverage(b,blast)>.52){
      b.hp--;b.hurtUntil=this.time+1;b.phase=b.hp?'retaliate':'dead';b.phaseUntil=this.time+(b.hp?2:.9);b.path=[];b.thinkAt=0;
      this.event('boss-hit',{x:b.x,y:b.y,hp:b.hp});
      if(!b.hp){this.event('boss-death',{x:b.x,y:b.y});this.dropBossLoot();}
    }
  }
  dangerCells(){
    const cells=new Set();
    for(const bomb of this.bombs){
      cells.add(`${bomb.x},${bomb.y}`);
      const owner=this.players.find(p=>p.id===bomb.owner),power=bomb.livePower&&owner?owner.power:bomb.power;
      for(const[dx,dy]of Object.values(DIR))for(let i=1;i<=power;i++){
        const x=bomb.x+dx*i,y=bomb.y+dy*i;if(this.solid(x,y)||this.blocksFlameEdge(x-dx,y-dy,x,y))break;
        cells.add(`${x},${y}`);
      }
    }
    return cells;
  }
  dropBossLoot(){
    const b=this.boss;if(b.lootDropped)return;b.lootDropped=true;b.rewardUntil=this.time+8;
    this.bombs=[];
    const cells=[];
    for(let y=0;y<13;y++)for(let x=0;x<15;x++)if(!this.solid(x,y)&&!this.items.some(i=>i.x===x&&i.y===y)&&!this.map.objects.some(o=>o.id===5010&&o.x===x&&o.y===y))cells.push({x,y});
    for(let i=cells.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
    for(const[kind,chance,max]of [['rose',.7,2],['chest',.35,1],['luckybag',.3,1],['kubi',.1,1]]){
      if(this.random()>=chance)continue;
      const count=1+Math.floor(this.random()*max);
      for(let i=0;i<count&&cells.length;i++)this.items.push({id:++this.serial,...cells.pop(),kind,availableAt:this.time+.85,flight:{x:b.x,y:b.y,born:this.time,duration:.85}});
    }
  }
  collectItem(p,item){
    if(['rose','chest','luckybag','kubi'].includes(item.kind)){
      p.rewards??={};p.rewards[item.kind]=(p.rewards[item.kind]||0)+1;
      this.event('boss-loot',{player:p.id,kind:item.kind});return;
    }
    super.collectItem(p,item);
  }
  placeBomb(p){if(this.boss?.hp===0)return false;return super.placeBomb(p);}
  findPath(goal,danger,escape=false){
    const b=this.boss,start={x:Math.floor(b.x),y:Math.floor(b.y)},queue=[{...start,path:[]}],seen=new Set([`${start.x},${start.y}`]);
    const aligned=path=>Math.hypot(b.x-start.x-.5,b.y-start.y-.5)>.01?[{x:start.x+.5,y:start.y+.5,dir:b.dir},...path]:path;
    let best=null,bestScore=Infinity;
    for(let at=0;at<queue.length;at++){
      const node=queue[at],unsafe=danger.has(`${node.x},${node.y}`);
      const score=(unsafe?1000:0)+(escape?node.path.length:Math.abs(node.x-goal.x)+Math.abs(node.y-goal.y)+node.path.length*.08);
      if(score<bestScore){bestScore=score;best=node.path;}
      if(escape&&!unsafe&&node.path.length)return aligned(node.path);
      if(!escape&&node.x===goal.x&&node.y===goal.y&&!unsafe)return aligned(node.path);
      for(const[dir,[dx,dy]]of Object.entries(DIR)){
        const x=node.x+dx,y=node.y+dy,key=`${x},${y}`;
        if(seen.has(key)||this.solid(x,y)||this.bombAt(x,y)||this.caveSideBlocked(node.x+.5,x+.5,node.y+.5,0))continue;
        if(!escape&&danger.has(key))continue;
        seen.add(key);queue.push({x,y,path:[...node.path,{x:x+.5,y:y+.5,dir}]});
      }
    }
    return aligned(best||[]);
  }
  bossBomb(){
    const b=this.boss,x=Math.floor(b.x),y=Math.floor(b.y);
    if(this.time<b.nextBomb||this.solid(x,y)||this.bombAt(x,y)||this.bombs.filter(p=>p.owner===b.id).length>=8)return false;
    const bomb={id:++this.serial,x,y,owner:b.id,team:1,power:8,born:this.time,explodeAt:this.time+RULES.fuse};
    this.bombs.push(bomb);
    // Do not deliberately trap the sailor in a dead end with its own bomb.
    const route=this.findPath({x,y},this.dangerCells(),true);
    const earliest=Math.min(...this.bombs.map(p=>p.explodeAt-this.time));
    const end=route.at(-1),danger=this.dangerCells();
    if(!route.length||route.length/4.2+.25>=earliest||danger.has(`${Math.floor(end.x)},${Math.floor(end.y)}`)){this.bombs.pop();return false;}
    for(const player of this.players)if(this.overlaps(player,x,y))player.passes.push(bomb.id);
    b.nextBomb=this.time+.65;b.path=route;b.thinkAt=this.time+.25;
    this.event('bomb',{x,y,player:b.id});return true;
  }
  tickBoss(dt){
    const b=this.boss;if(!b)return;
    if(b.hp<=0){if(this.time>=b.phaseUntil)this.finish(0,'海盗水手已被击败！');return;}
    if(b.phase==='birth'){if(this.time<b.phaseUntil)return;b.phase='chase';}
    const targets=this.players.filter(p=>p.status!=='dead');
    if(!targets.length){this.finish(1,'所有队员已阵亡');return;}
    const target=targets.reduce((a,p)=>Math.hypot(p.x-b.x,p.y-b.y)<Math.hypot(a.x-b.x,a.y-b.y)?p:a);
    const danger=this.dangerCells(),unsafe=danger.has(`${Math.floor(b.x)},${Math.floor(b.y)}`);
    const centred=Math.abs(b.x-Math.floor(b.x)-.5)<.005&&Math.abs(b.y-Math.floor(b.y)-.5)<.005;
    if(this.time>=b.thinkAt&&(centred||!b.path.length)){
      b.thinkAt=this.time+.2;
      const ownBombs=this.bombs.filter(p=>p.owner===b.id).length;
      b.phase=unsafe?'evade':ownBombs>=3?'wait':'chase';
      if(b.phase==='wait')b.path=[];
      else b.path=this.findPath({x:Math.floor(target.x),y:Math.floor(target.y)},danger,unsafe);
      if(centred&&ownBombs<3&&(Math.abs(target.x-b.x)<.6||Math.abs(target.y-b.y)<.6||Math.hypot(target.x-b.x,target.y-b.y)<5))this.bossBomb();
    }
    b.moving=false;
    if(b.path.length){
      const point=b.path[0],dx=point.x-b.x,dy=point.y-b.y,d=Math.hypot(dx,dy),step=Math.min(d,4.2*dt);
      if(d<.005)b.path.shift();else{
        const x=b.x+dx/d*step,y=b.y+dy/d*step;
        if(!this.caveSideBlocked(b.x,x,y,.45)&&!this.solid(Math.floor(x),Math.floor(y))&&(!this.bombAt(Math.floor(x),Math.floor(y))||(Math.floor(x)===Math.floor(b.x)&&Math.floor(y)===Math.floor(b.y)))){b.x=x;b.y=y;b.dir=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';b.moving=true;if(step>=d-1e-8){b.x=point.x;b.y=point.y;b.path.shift();}}else{b.path=[];b.thinkAt=this.time+.2;}
      }
    }
    if(this.time>=b.nextGlue){
      b.nextGlue=this.time+12;
      // 每轮 6 个笑脸（原来 3 个），12 秒一轮；随机点重复或落在实心格子上会被跳过。
      for(let i=0;i<6;i++){
        const x=Math.floor(this.random()*15),y=Math.floor(this.random()*13);
        if(!this.solid(x,y)&&!this.bombAt(x,y)&&!this.items.some(p=>p.x===x&&p.y===y))this.items.push({id:++this.serial,x,y,kind:'smile-trap',availableAt:this.time+.6,flight:{x:b.x,y:b.y,born:this.time,duration:.6}});
      }
    }
    for(const p of targets)if(p.status==='trapped'&&Math.hypot(p.x-b.x,p.y-b.y)<.6)this.kill(p,b.id);
  }
  // 玩家踏进洞口时点亮一下（原版 elem10 有一组 5 帧的 trigger）。只在「刚进去」
  // 那一帧发事件，人一直待在里面不会反复亮。只认玩家不认水手——认水手的话洞口
  // 就成了水手的位置指示器，而洞口本来是帮它藏身的。
  tickCaves(){
    const inside=new Set();
    for(const p of this.players){
      if(p.status==='dead')continue;
      const hole=this.map.objects.find(o=>o.id===5010&&p.x>=o.x&&p.x<o.x+o.w&&p.y>=o.y&&p.y<o.y+o.h);
      if(hole)inside.add(`${hole.x},${hole.y}`);
    }
    for(const key of inside)if(!this.caveOccupants.has(key)){
      const[x,y]=key.split(',').map(Number);this.event('cave-lit',{x,y});
    }
    this.caveOccupants=inside;
  }
  tick(dt=RULES.tick){
    if(this.state==='playing'&&this.boss?.hp===0){
      this.time+=dt;this.flames=this.flames.filter(f=>f.until>this.time);
      for(const p of this.players)if(p.status==='alive'){this.move(p,dt);this.objectives(p);}
      this.tickCaves();
      if(this.time>=this.boss.rewardUntil)this.finish(0,'海盗水手已被击败！');return;
    }
    // Cooperative ordinary-rule elimination: no automatic respawn.
    if(this.state==='playing'&&this.remaining<=dt){this.remaining=0;this.finish(1,'时间到，海盗水手仍未被击败');return;}
    super.tick(dt);
    if(this.state==='playing'){
      if(this.practice)this.remaining=Math.max(0,this.remaining-dt);
      this.tickCaves();
      this.tickBoss(dt);
    }
  }
  snapshot(){const state=super.snapshot();return {...state,mapId:this.map.id,mode:'water11',boss:this.boss?{...this.boss,path:undefined}:null};}
}
