/*
  Texas Hold'em (single-player) - front-end only
  - 1 human + 5 AI seats (full table = 6)
  - No multiplayer
  - Simplified betting model (still feels like Hold'em):
    * fixed blinds (SB/BB)
    * betting rounds: preflop/flop/turn/river
    * actions: fold, check/call, raise (amount)
  - AI uses heuristic hand strength + style parameters + randomness

  NOTE: This is not a solver; it's an approachable toy engine that runs in the browser.
*/

(function(){
  // ---------- Utilities
  const $ = (id) => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ---------- Cards
  const SUITS = ['♠','♥','♦','♣'];
  const RANKS = [2,3,4,5,6,7,8,9,10,'J','Q','K','A'];
  const RANK_VALUE = new Map(RANKS.map((r,i)=>[r, i+2]));

  function makeDeck(){
    const deck=[];
    for(const s of SUITS){
      for(const r of RANKS){
        deck.push({r, s});
      }
    }
    return deck;
  }

  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  }

  function cardToText(c){
    return `${c.r}${c.s}`;
  }
  function suitColor(s){
    return (s==='♥' || s==='♦') ? 'red' : '';
  }

  // ---------- Hand evaluation (heuristic but consistent)
  // We compute a strength score in [0..1] from 7 cards.
  // It's not perfect ranking, but captures big categories.

  function eval7(cards){
    // counts
    const ranks = cards.map(c => RANK_VALUE.get(c.r)).sort((a,b)=>b-a);
    const suitMap = new Map();
    const rankCount = new Map();
    for(const c of cards){
      suitMap.set(c.s, (suitMap.get(c.s)||0)+1);
      const v=RANK_VALUE.get(c.r);
      rankCount.set(v, (rankCount.get(v)||0)+1);
    }

    const counts = [...rankCount.entries()].sort((a,b)=> (b[1]-a[1]) || (b[0]-a[0]));
    const isFlush = [...suitMap.values()].some(n => n>=5);

    // straight check (A can be low)
    const uniq = [...new Set(ranks)].sort((a,b)=>b-a);
    let straightHigh = null;
    // wheel
    const wheel = [14,5,4,3,2];
    const hasWheel = wheel.every(v => uniq.includes(v));
    if(hasWheel) straightHigh = 5;
    for(let i=0;i<=uniq.length-5;i++){
      const slice = uniq.slice(i,i+5);
      if(slice[0]-slice[4]===4){
        straightHigh = Math.max(straightHigh||0, slice[0]);
      }
    }
    const isStraight = straightHigh !== null;

    // very rough category score
    // categories: highcard, pair, two pair, trips, straight, flush, fullhouse, quads, straightflush
    let cat = 0; // 0..8

    const topCount = counts[0]?.[1] || 1;
    const secondCount = counts[1]?.[1] || 1;

    const hasTrips = topCount===3 || secondCount===3;
    const hasPair = topCount===2 || secondCount===2;
    const pairs = counts.filter(x=>x[1]===2).length;

    if(isStraight && isFlush) cat = 8;
    else if(topCount===4) cat = 7;
    else if((topCount===3 && secondCount>=2) || (hasTrips && pairs>=1)) cat = 6;
    else if(isFlush) cat = 5;
    else if(isStraight) cat = 4;
    else if(topCount===3) cat = 3;
    else if(pairs>=2) cat = 2;
    else if(topCount===2) cat = 1;
    else cat = 0;

    // kicker-ish refinement
    const hi = ranks[0] || 2;
    const base = cat / 8;
    const kicker = (hi-2)/12 * 0.08; // small refinement

    // pair/trips strength bump based on involved rank
    let comboBump = 0;
    if(cat===1 || cat===2 || cat===3 || cat===6 || cat===7){
      const mainRank = counts[0][0];
      comboBump = (mainRank-2)/12 * 0.10;
    }
    if(cat===8){
      comboBump = (straightHigh-5)/9 * 0.12;
    }

    return clamp(base + kicker + comboBump, 0, 1);
  }

  // Preflop hole strength heuristic (0..1)
  function preflopStrength(hole){
    const a = RANK_VALUE.get(hole[0].r);
    const b = RANK_VALUE.get(hole[1].r);
    const hi = Math.max(a,b);
    const lo = Math.min(a,b);
    const suited = hole[0].s === hole[1].s;
    const pair = a===b;

    let s = 0.15;
    // high cards
    s += (hi-2)/12 * 0.25;
    s += (lo-2)/12 * 0.10;

    if(pair) s += 0.30 + (hi-2)/12 * 0.12;
    if(suited) s += 0.07;

    const gap = hi-lo;
    if(gap===1) s += 0.06;
    else if(gap===2) s += 0.03;
    else if(gap>=5) s -= 0.04;

    // Broadway bonus
    if(hi>=11 && lo>=10) s += 0.08;

    return clamp(s, 0, 1);
  }

  // ---------- Player / AI styles
  const STYLES = [
    {
      key: 'tight',
      name: '紧凶（TAG）',
      desc: '起手谨慎，偏强牌进池；进池后敢打。',
      play: { vpip: 0.22, aggr: 0.70, bluff: 0.12, callDown: 0.40 }
    },
    {
      key: 'loose',
      name: '松凶（LAG）',
      desc: '起手宽，喜欢施压，偶尔大诈唬。',
      play: { vpip: 0.40, aggr: 0.82, bluff: 0.22, callDown: 0.48 }
    },
    {
      key: 'nit',
      name: '超紧（Nit）',
      desc: '只玩很强的牌，没牌就弃。',
      play: { vpip: 0.14, aggr: 0.55, bluff: 0.06, callDown: 0.28 }
    },
    {
      key: 'station',
      name: '跟注站（Calling Station）',
      desc: '很少弃牌，喜欢跟到摊牌。',
      play: { vpip: 0.38, aggr: 0.35, bluff: 0.05, callDown: 0.78 }
    },
    {
      key: 'maniac',
      name: '疯狗（Maniac）',
      desc: '极度激进，高频加注。',
      play: { vpip: 0.55, aggr: 0.95, bluff: 0.30, callDown: 0.35 }
    }
  ];

  function makeAIProfiles(){
    // 5 AI seats, mix styles
    return [
      {name:'Astra', style: STYLES[0]},
      {name:'Beryl', style: STYLES[1]},
      {name:'Cato',  style: STYLES[2]},
      {name:'Dune',  style: STYLES[3]},
      {name:'Echo',  style: STYLES[4]},
    ];
  }

  // ---------- Game state
  const GAME = {
    seats: [],
    dealer: 0,
    sb: 10,
    bb: 20,
    street: 'preflop',
    pot: 0,
    community: [],
    deck: [],
    currentBet: 0,
    toAct: 0,
    minRaiseTo: 0,
    handOver: false,
    awaitingHuman: false,
    actionLock: false,

    // auto-next-hand
    autoNext: true,
    autoNextDelayMs: 1200,
    autoTimer: null,
  };

  function log(msg){
    const box = $('log');
    const p = document.createElement('div');
    p.className='log-line';
    p.textContent = msg;
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
  }

  function scheduleAutoNextHand(){
    if(!GAME.autoNext) return;
    // If someone is busted and only one player has chips, don't loop forever.
    const alive = GAME.seats.filter(s => seatAlive(s));
    if(alive.length <= 1){
      log('\n（游戏结束：只剩一位玩家有筹码。请点“重置筹码”重新开始。）');
      return;
    }

    if(GAME.autoTimer) clearTimeout(GAME.autoTimer);
    GAME.autoTimer = setTimeout(()=>{
      if(GAME.handOver) newHand();
    }, GAME.autoNextDelayMs);
  }

  function fmt(n){
    return Math.round(n).toString();
  }

  function seatAlive(s){
    return s.stack>0;
  }

  function activePlayers(){
    return GAME.seats.filter(s => s.inHand && !s.folded);
  }

  function nextIndex(i){
    const n=GAME.seats.length;
    for(let k=1;k<=n;k++){
      const j=(i+k)%n;
      if(GAME.seats[j].inHand && !GAME.seats[j].folded) return j;
    }
    return i;
  }

  function allBetsMatched(){
    const players = activePlayers();
    if(players.length<=1) return true;
    return players.every(p => p.bet === GAME.currentBet || p.allIn);
  }

  function resetBets(){
    for(const s of GAME.seats){
      s.bet = 0;
    }
    GAME.currentBet = 0;
    GAME.minRaiseTo = 0;
  }

  // ---------- Rendering
  function renderCard(c, small=false, faceDown=false){
    const d=document.createElement('div');
    d.className='card' + (small?' small':'');
    if(faceDown){
      d.classList.add('back');
      d.textContent = '•';
      return d;
    }
    d.textContent = cardToText(c);
    const col = suitColor(c.s);
    if(col) d.classList.add(col);
    return d;
  }

  function render(){
    // ----- Desktop UI (existing)
    $('street').textContent = streetName(GAME.street);
    $('pot').textContent = fmt(GAME.pot);
    $('currentBet').textContent = fmt(GAME.currentBet);
    $('turn').textContent = GAME.seats[GAME.toAct]?.name || '-';

    // community
    const cc=$('communityCards');
    cc.innerHTML='';
    for(const c of GAME.community){
      cc.appendChild(renderCard(c,false,false));
    }

    // seats
    const seatsEl=$('seats');
    seatsEl.innerHTML='';
    GAME.seats.forEach((s, idx) => {
      const el=document.createElement('div');
      el.className='seat';
      if(idx===GAME.toAct && !GAME.handOver) el.classList.add('active');
      if(s.folded) el.classList.add('folded');
      const name=document.createElement('div');
      name.className='name';
      const left=document.createElement('div');
      left.innerHTML = `<div class="who">${escapeHtml(s.name)}${s.isHuman?'（你）':''}</div><div class="style">${s.isHuman?'玩家':escapeHtml(s.profile.style.name)}</div>`;
      const right=document.createElement('div');
      right.style.color='var(--muted)';
      right.style.fontSize='12px';
      right.textContent = s.allIn ? '全下' : (s.folded?'弃牌':'');
      name.appendChild(left);
      name.appendChild(right);

      const status=document.createElement('div');
      status.className='status';
      status.innerHTML = `<div>筹码：${fmt(s.stack)}</div><div>本轮下注：${fmt(s.bet)}</div>`;

      const cards=document.createElement('div');
      cards.className='cards';
      if(s.isHuman){
        // human cards shown in side panel
        cards.appendChild(renderCard({r:'',s:'♠'},true,true));
        cards.appendChild(renderCard({r:'',s:'♠'},true,true));
      }else{
        const show = GAME.handOver;
        cards.appendChild(renderCard(s.hole[0], true, !show));
        cards.appendChild(renderCard(s.hole[1], true, !show));
      }

      el.appendChild(name);
      el.appendChild(status);
      el.appendChild(cards);
      seatsEl.appendChild(el);
    });

    // your cards
    const yc=$('yourCards');
    yc.innerHTML='';
    const you = GAME.seats.find(s=>s.isHuman);
    if(you?.hole?.length===2){
      yc.appendChild(renderCard(you.hole[0], false, false));
      yc.appendChild(renderCard(you.hole[1], false, false));
    }
    $('yourStack').textContent = fmt(you?.stack||0);

    // controls (desktop)
    const isYourTurn = (GAME.seats[GAME.toAct]?.isHuman && !GAME.handOver);
    $('btnFold').disabled = !isYourTurn || GAME.actionLock;
    $('btnCheckCall').disabled = !isYourTurn || GAME.actionLock;
    $('btnRaise').disabled = !isYourTurn || GAME.actionLock;
    $('raiseAmount').disabled = !isYourTurn || GAME.actionLock;
    for(const b of document.querySelectorAll('.chip')){
      b.disabled = !isYourTurn || GAME.actionLock;
    }

    // ----- Mobile UI (oval table)
    // If elements exist (mobile-only), update them too.
    if(document.getElementById('m-community')){
      $('m-pot').textContent = fmt(GAME.pot);

      const mcc = $('m-community');
      mcc.innerHTML='';
      for(const c of GAME.community){
        mcc.appendChild(renderCard(c,false,false));
      }

      // map seats to fixed positions (6-max)
      // pos: 0 hero bottom, 1 left-bottom, 2 left-top, 3 top, 4 right-top, 5 right-bottom
      const map = [0, 1, 2, 3, 4, 5];
      for(let pos=0; pos<6; pos++){
        const seatIdx = map[pos];
        const box = document.getElementById('m-seat-'+pos);
        if(!box) continue;
        const s = GAME.seats[seatIdx];
        if(!s){ box.innerHTML=''; continue; }

        const turnMark = (seatIdx===GAME.toAct && !GAME.handOver) ? ' · 回合' : '';
        const stateMark = s.allIn ? '全下' : (s.folded ? '弃牌' : '');
        const styleName = s.isHuman ? '玩家' : s.profile.style.name;

        const show = GAME.handOver;
        const hasHole = Array.isArray(s.hole) && s.hole.length >= 2;
        // Guard: if hole cards are not yet dealt, show placeholders instead of breaking render.
        const placeholder = { r:'?', s:'?' };
        const h0 = hasHole ? s.hole[0] : placeholder;
        const h1 = hasHole ? s.hole[1] : placeholder;
        const c1 = s.isHuman || show ? renderCard(h0, true, false) : renderCard(h0, true, true);
        const c2 = s.isHuman || show ? renderCard(h1, true, false) : renderCard(h1, true, true);

        box.innerHTML='';
        const row1=document.createElement('div');
        row1.className='row1';
        row1.textContent = `${s.name}${s.isHuman?'（你）':''}${turnMark}`;

        const row2=document.createElement('div');
        row2.className='row2';
        // show bet or folded/all-in state + balance
        const betOrState = stateMark || `下注 ${fmt(s.bet)}`;
        row2.innerHTML = `<span>${betOrState}</span><span>余额 ${fmt(s.stack)}</span>`;

        const row3=document.createElement('div');
        row3.className='row3';
        row3.appendChild(c1);
        row3.appendChild(c2);

        box.appendChild(row1);
        box.appendChild(row2);
        box.appendChild(row3);
      }

      // mobile actionbar state
      $('m-btnFold').disabled = !isYourTurn || GAME.actionLock;
      $('m-btnCheckCall').disabled = !isYourTurn || GAME.actionLock;
      $('m-btnRaise').disabled = !isYourTurn || GAME.actionLock;
      $('m-raiseAmount').disabled = !isYourTurn || GAME.actionLock;

      // mirror raiseAmount
      const v = Number($('raiseAmount').value||0);
      if(!Number.isNaN(v)) $('m-raiseAmount').value = String(v);

    }
  }

  function streetName(st){
    switch(st){
      case 'preflop': return '翻牌前';
      case 'flop': return '翻牌';
      case 'turn': return '转牌';
      case 'river': return '河牌';
      case 'showdown': return '摊牌';
      default: return st;
    }
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c)=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // ---------- Core flow
  function newGame(){
    $('log').innerHTML='';
    GAME.seats=[];
    const ai = makeAIProfiles();
    GAME.seats.push({
      id:0, name:'你', isHuman:true, profile:null,
      stack: 2000, hole:[], bet:0, inHand:true, folded:false, allIn:false,
      acted:false
    });
    ai.forEach((p, i)=>{
      GAME.seats.push({
        id:i+1, name:p.name, isHuman:false, profile:p,
        stack: 2000, hole:[], bet:0, inHand:true, folded:false, allIn:false,
        acted:false
      });
    });

    GAME.dealer = 0;
    log('新游戏：每人 2000 筹码。');
    newHand();
  }

  function newHand(){
    GAME.handOver=false;
    GAME.community=[];
    GAME.deck = shuffle(makeDeck());
    GAME.pot=0;
    GAME.street='preflop';
    GAME.actionLock=false;

    // reset per-seat
    GAME.seats.forEach(s=>{
      s.hole=[]; s.bet=0; s.folded=false; s.allIn=false; s.inHand = seatAlive(s);
      s.acted=false;
    });

    // move dealer to next alive
    GAME.dealer = nextDealer(GAME.dealer);

    // deal hole cards
    for(let r=0;r<2;r++){
      for(let i=0;i<GAME.seats.length;i++){
        const idx=(GAME.dealer+1+i)%GAME.seats.length; // start from SB seat
        const s=GAME.seats[idx];
        if(s.inHand){
          s.hole.push(GAME.deck.pop());
        }
      }
    }

    // post blinds
    const sbIdx = nextInHand(GAME.dealer);
    const bbIdx = nextInHand(sbIdx);
    postBlind(sbIdx, GAME.sb, '小盲');
    postBlind(bbIdx, GAME.bb, '大盲');
    GAME.currentBet = GAME.bb;
    GAME.minRaiseTo = GAME.bb * 2;

    // preflop first action is after BB
    GAME.toAct = nextIndex(bbIdx);

    log(`\n--- 新的一局开始（庄家：${GAME.seats[GAME.dealer].name}） ---`);
    render();

    // let AI act until human
    runUntilHuman();
  }

  function nextDealer(from){
    let d=from;
    for(let k=1;k<=GAME.seats.length;k++){
      const j=(from+k)%GAME.seats.length;
      if(seatAlive(GAME.seats[j])) return j;
    }
    return d;
  }

  function nextInHand(from){
    const n=GAME.seats.length;
    for(let k=1;k<=n;k++){
      const j=(from+k)%n;
      if(GAME.seats[j].inHand && !GAME.seats[j].folded) return j;
    }
    return from;
  }

  function postBlind(idx, amt, label){
    const s=GAME.seats[idx];
    const pay = Math.min(amt, s.stack);
    s.stack -= pay;
    s.bet += pay;
    GAME.pot += pay;
    if(s.stack===0) s.allIn=true;
    log(`${s.name} 付 ${label} ${pay}`);
  }

  async function runUntilHuman(){
    // Prevent re-entrance
    if(GAME.actionLock) return;
    GAME.actionLock=true;

    try{
      while(!GAME.handOver && !GAME.seats[GAME.toAct].isHuman){
        await sleep(350 + Math.random()*350);
        await aiAct(GAME.toAct);
        if(GAME.handOver) break;
        if(allBetsMatched() && allActedThisRound()){
          advanceStreet();
        }
        render();
      }
    }catch(e){
      console.error('[holdem] runUntilHuman error', e);
      log('（出现错误：已自动解锁操作。你可以继续，或点“重置筹码”重新开始。）');
    }finally{
      GAME.actionLock=false;
      render();
    }
  }

  function allActedThisRound(){
    const players = activePlayers();
    if(players.length<=1) return true;
    // acted = either matched bet or all-in/folded
    return players.every(p => p.acted || p.allIn);
  }

  function markActed(idx){
    const s=GAME.seats[idx];
    s.acted=true;
  }

  function resetActed(){
    for(const s of GAME.seats){
      s.acted=false;
    }
  }

  function endHandSingleWinner(winnerIdx){
    const w=GAME.seats[winnerIdx];
    w.stack += GAME.pot;
    log(`\n${w.name} 赢下底池 ${fmt(GAME.pot)}（其他人弃牌）。`);
    GAME.pot=0;
    GAME.handOver=true;
    render();

    scheduleAutoNextHand();
  }

  function advanceStreet(){
    // collect bets into pot already done; pot is tracking as we deduct.
    // reset bets and acted
    GAME.seats.forEach(s=>{ s.bet = 0; });
    GAME.currentBet = 0;
    GAME.minRaiseTo = GAME.bb; // baseline
    resetActed();

    if(GAME.street==='preflop'){
      // flop 3
      GAME.community.push(GAME.deck.pop(), GAME.deck.pop(), GAME.deck.pop());
      GAME.street='flop';
      log('\n发出翻牌。');
    }else if(GAME.street==='flop'){
      GAME.community.push(GAME.deck.pop());
      GAME.street='turn';
      log('\n发出转牌。');
    }else if(GAME.street==='turn'){
      GAME.community.push(GAME.deck.pop());
      GAME.street='river';
      log('\n发出河牌。');
    }else if(GAME.street==='river'){
      GAME.street='showdown';
      showdown();
      return;
    }

    // first to act postflop is after dealer (SB position)
    GAME.toAct = nextIndex(GAME.dealer);
  }

  function showdown(){
    const players = activePlayers();
    if(players.length===1){
      endHandSingleWinner(GAME.seats.indexOf(players[0]));
      return;
    }
    log('\n--- 摊牌 ---');
    const scored = players.map(p => {
      const strength = eval7(p.hole.concat(GAME.community));
      return {p, strength};
    }).sort((a,b)=>b.strength-a.strength);

    const best = scored[0];
    const winners = scored.filter(x => Math.abs(x.strength - best.strength) < 1e-6);

    if(winners.length===1){
      const w = winners[0].p;
      w.stack += GAME.pot;
      log(`${w.name} 获胜，赢下底池 ${fmt(GAME.pot)}。`);
    }else{
      const share = Math.floor(GAME.pot / winners.length);
      winners.forEach(w=>{ w.p.stack += share; });
      log(`平分底池：${winners.map(w=>w.p.name).join('、')} 各得 ${fmt(share)}。`);
    }

    // reveal
    scored.forEach(({p,strength})=>{
      log(`${p.name} 手牌 ${cardToText(p.hole[0])} ${cardToText(p.hole[1])} 强度≈${strength.toFixed(2)}`);
    });

    GAME.pot=0;
    GAME.handOver=true;
    render();

    scheduleAutoNextHand();
  }

  function commitChips(idx, toBet){
    const s=GAME.seats[idx];
    const need = Math.max(0, toBet - s.bet);
    const pay = Math.min(need, s.stack);
    s.stack -= pay;
    s.bet += pay;
    GAME.pot += pay;
    if(s.stack===0) s.allIn=true;
    return pay;
  }

  async function aiAct(idx){
    const s=GAME.seats[idx];
    if(s.folded || !s.inHand) {
      GAME.toAct = nextIndex(idx);
      return;
    }

    const style = s.profile.style.play;
    const facing = GAME.currentBet - s.bet;

    // Estimate strength
    const strength = (GAME.street==='preflop')
      ? preflopStrength(s.hole)
      : eval7(s.hole.concat(GAME.community));

    // Decide willingness based on VPIP threshold
    // Use random noise so same cards don't always act same.
    const noise = (Math.random()-0.5) * 0.12;
    const willing = strength + noise;

    // compute thresholds
    const playThresh = 1 - style.vpip; // lower vpip => higher threshold

    // if facing bet
    if(facing > 0){
      // fold if weak and not a calling station
      const foldThresh = playThresh + (facing/(GAME.bb*10)) * (1-style.callDown) * 0.35;
      if(willing < foldThresh){
        s.folded=true;
        log(`${s.name} 弃牌`);
        markActed(idx);
        if(activePlayers().length===1){
          endHandSingleWinner(GAME.seats.indexOf(activePlayers()[0]));
          return;
        }
        GAME.toAct = nextIndex(idx);
        return;
      }

      // call mostly
      const callPay = commitChips(idx, GAME.currentBet);
      log(`${s.name} 跟注 ${fmt(callPay)}`);
      markActed(idx);

      // occasional raise
      const canRaise = !s.allIn && (strength > 0.55 || Math.random() < style.bluff);
      if(canRaise && Math.random() < style.aggr){
        const target = proposeRaiseTarget(strength, style);
        if(target > GAME.currentBet){
          const pay2 = commitChips(idx, target);
          GAME.currentBet = s.bet;
          GAME.minRaiseTo = GAME.currentBet + (GAME.currentBet - (GAME.currentBet - pay2));
          // reset acted for others
          resetActed();
          markActed(idx);
          log(`${s.name} 加注到 ${fmt(GAME.currentBet)}（再付 ${fmt(pay2)}）`);
        }
      }

      GAME.toAct = nextIndex(idx);
      return;
    }

    // facing no bet -> check or bet
    if(willing < playThresh - 0.05){
      log(`${s.name} 过牌`);
      markActed(idx);
      GAME.toAct = nextIndex(idx);
      return;
    }

    // decide to bet
    const betChance = style.aggr * (0.35 + strength*0.8);
    if(!s.allIn && Math.random() < betChance){
      const target = proposeBetTarget(strength, style);
      const pay = commitChips(idx, target);
      GAME.currentBet = s.bet;
      GAME.minRaiseTo = GAME.currentBet * 2;
      resetActed();
      markActed(idx);
      log(`${s.name} 下注到 ${fmt(GAME.currentBet)}（付 ${fmt(pay)}）`);
      GAME.toAct = nextIndex(idx);
      return;
    }

    log(`${s.name} 过牌`);
    markActed(idx);
    GAME.toAct = nextIndex(idx);
  }

  function proposeBetTarget(strength, style){
    // If no current bet, choose size based on strength.
    const pot = Math.max(1, GAME.pot);
    let frac = 0.4;
    if(strength>0.80) frac = 0.9;
    else if(strength>0.65) frac = 0.65;
    else if(strength>0.55) frac = 0.50;
    else frac = 0.35 + style.bluff*0.2;

    const amt = Math.round(pot*frac/10)*10;
    return Math.max(GAME.bb, amt);
  }

  function proposeRaiseTarget(strength, style){
    const pot = Math.max(1, GAME.pot);
    const base = GAME.currentBet;
    let addFrac = 0.6;
    if(strength>0.85) addFrac = 1.2;
    else if(strength>0.70) addFrac = 0.9;
    else if(strength>0.60) addFrac = 0.7;
    else addFrac = 0.55 + style.bluff*0.3;

    const target = base + Math.round(pot*addFrac/10)*10;
    return Math.max(GAME.minRaiseTo, target);
  }

  // ---------- Human actions
  function humanFold(){
    if(GAME.actionLock) return;
    const idx = GAME.toAct;
    const s=GAME.seats[idx];
    s.folded=true;
    log('你 弃牌');
    markActed(idx);
    if(activePlayers().length===1){
      endHandSingleWinner(GAME.seats.indexOf(activePlayers()[0]));
      return;
    }
    GAME.toAct = nextIndex(idx);
    render();
    runUntilHuman();
  }

  function humanCheckCall(){
    if(GAME.actionLock) return;
    const idx=GAME.toAct;
    const s=GAME.seats[idx];
    const facing = GAME.currentBet - s.bet;
    if(facing>0){
      const pay = commitChips(idx, GAME.currentBet);
      log(`你 跟注 ${fmt(pay)}`);
    }else{
      log('你 过牌');
    }
    markActed(idx);

    GAME.toAct = nextIndex(idx);
    if(allBetsMatched() && allActedThisRound()){
      advanceStreet();
    }
    render();
    runUntilHuman();
  }

  function humanRaise(amount){
    if(GAME.actionLock) return;
    const idx=GAME.toAct;
    const s=GAME.seats[idx];
    const facing = GAME.currentBet - s.bet;

    let target;
    if(GAME.currentBet===0){
      target = Math.max(GAME.bb, amount);
    }else{
      target = Math.max(GAME.minRaiseTo, amount);
    }

    target = Math.min(target, s.bet + s.stack); // all-in cap

    if(target <= GAME.currentBet && facing>0){
      log('加注无效：金额不足（已按跟注处理）。');
      humanCheckCall();
      return;
    }

    const pay = commitChips(idx, target);
    GAME.currentBet = s.bet;
    GAME.minRaiseTo = Math.max(GAME.currentBet + (GAME.currentBet - (GAME.currentBet - pay)), GAME.currentBet + GAME.bb);

    resetActed();
    markActed(idx);
    log(`你 加注到 ${fmt(GAME.currentBet)}（付 ${fmt(pay)}）`);

    GAME.toAct = nextIndex(idx);
    render();
    runUntilHuman();
  }

  // ---------- UI wiring
  function setupUI(){
    $('btnNewGame').addEventListener('click', ()=>newGame());

    // desktop actions
    $('btnFold').addEventListener('click', ()=>humanFold());
    $('btnCheckCall').addEventListener('click', ()=>humanCheckCall());
    $('btnRaise').addEventListener('click', ()=>{
      const v = Number($('raiseAmount').value||0);
      humanRaise(v);
    });

    // mobile actions
    const mFold = document.getElementById('m-btnFold');
    const mCC = document.getElementById('m-btnCheckCall');
    const mRaise = document.getElementById('m-btnRaise');
    const mAmt = document.getElementById('m-raiseAmount');
    if(mFold && mCC && mRaise && mAmt){
      mFold.addEventListener('click', ()=>humanFold());
      mCC.addEventListener('click', ()=>humanCheckCall());
      mRaise.addEventListener('click', ()=>{
        const v = Number((mAmt).value||0);
        // keep desktop field in sync for convenience
        $('raiseAmount').value = String(v);
        humanRaise(v);
      });
      mAmt.addEventListener('change', ()=>{
        $('raiseAmount').value = String((mAmt).value||0);
      });

    }

    document.querySelectorAll('.chip').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const you = GAME.seats.find(s=>s.isHuman);
        const key = btn.getAttribute('data-quick');
        let target = GAME.currentBet;
        if(key==='min'){
          target = (GAME.currentBet===0) ? GAME.bb : GAME.minRaiseTo;
        }else if(key==='halfpot'){
          target = (GAME.currentBet===0) ? Math.round(GAME.pot*0.5/10)*10 : Math.round((GAME.currentBet + GAME.pot*0.5)/10)*10;
        }else if(key==='pot'){
          target = (GAME.currentBet===0) ? Math.round(GAME.pot/10)*10 : Math.round((GAME.currentBet + GAME.pot)/10)*10;
        }else if(key==='allin'){
          target = you.bet + you.stack;
        }
        const val = Math.max(GAME.bb, Math.round(target/10)*10);
        $('raiseAmount').value = val;
        const mAmt2 = document.getElementById('m-raiseAmount');
        if(mAmt2) mAmt2.value = val;
      });
    });
  }

  // ---------- Boot
  setupUI();
  newGame();

})();
