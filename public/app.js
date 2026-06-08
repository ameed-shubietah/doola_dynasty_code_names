const socket = io();
let state = null, selectedCharacter = 'raiden', targetIds = new Set(), lastRevealed = new Set();
let lastWinKey = null, winDockTimer = null;
let playerKey = localStorage.cc_playerKey || ('p_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
localStorage.cc_playerKey = playerKey;
let myId = playerKey;

const $ = id => document.getElementById(id);
const landing = $('landing'), game = $('game'), board = $('board');
const nameInput = $('name'), roomInput = $('roomCode');
nameInput.value = localStorage.cc_name || '';
const params = new URLSearchParams(location.search);
const inviteRoom = (params.get('room') || params.get('r') || '').trim().toUpperCase();
if(inviteRoom) roomInput.value = inviteRoom;
let selectedTeamChoice = '';
let selectedRoleChoice = '';

function inviteUrl(roomId){ return `${location.origin}${location.pathname}?room=${String(roomId||'').toUpperCase()}`; }
function updateInviteFields(roomId){
  const code = String(roomId || roomInput.value || '').trim().toUpperCase();
  const link = code ? inviteUrl(code) : '';
  const l1=$('inviteLinkLanding'), l2=$('inviteLinkGame'), l3=$('topInviteLink');
  if(l1) l1.value = link;
  if(l2) l2.value = link;
  if(l3) l3.value = link;
}
function requestLobbyInfo(){
  const code = roomInput.value.trim().toUpperCase();
  updateInviteFields(code);
  const box = $('lobbyPreview');
  if(!box) return;
  if(!code || !selectedTeamChoice || !selectedRoleChoice){ box.classList.add('hidden'); box.innerHTML=''; return; }
  socket.emit('getRoomInfo', { roomId: code }, res => {
    if(roomInput.value.trim().toUpperCase() !== code) return;
    if(!res || !res.ok){ box.classList.remove('hidden'); box.innerHTML = `<b>Room preview</b><span class="muted">Room not found yet. Create it or check the code.</span>`; return; }
    const gs = (res.spymasters?.blue || []).join(', ') || 'No Gold spymaster online';
    const bs = (res.spymasters?.red || []).join(', ') || 'No Black spymaster online';
    box.classList.remove('hidden');
    box.innerHTML = `<b>Room ${res.roomId} preview</b><div class="previewGrid"><span>Gold: <strong>${res.counts.blue}</strong></span><span>Black: <strong>${res.counts.red}</strong></span><span>Spectators: <strong>${res.counts.spectator}</strong></span><span>Total: <strong>${res.playersTotal}</strong></span></div><div class="previewSpies"><span>Gold spymaster: <strong>${gs}</strong></span><span>Black spymaster: <strong>${bs}</strong></span></div>`;
  });
}
roomInput.addEventListener('input', requestLobbyInfo);
setTimeout(requestLobbyInfo, 200);

const audio = new (window.AudioContext || window.webkitAudioContext)();
function tone(freq=440, dur=.16, type='sine', gain=.05){
  try{ const o=audio.createOscillator(), g=audio.createGain(); o.type=type; o.frequency.value=freq; g.gain.value=gain; o.connect(g); g.connect(audio.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime+dur); o.stop(audio.currentTime+dur); }catch{}
}
function sound(kind){
  if(audio.state==='suspended') audio.resume();
  if(kind==='win'){
    tone(523,.09,'sine',.035); setTimeout(()=>tone(659,.10,'sine',.035),80); setTimeout(()=>tone(784,.14,'triangle',.04),165); flash('winFlash');
  }
  if(kind==='gameWin'){
    [523,659,784,1046,1318].forEach((f,i)=>setTimeout(()=>tone(f,.16,'triangle',.045),i*95));
    setTimeout(()=>tone(1568,.24,'sine',.035),520);
    flash('winFlash');
  }
  if(kind==='lose'){ tone(220,.14,'sawtooth'); setTimeout(()=>tone(130,.2,'sawtooth'),120); flash('loseFlash'); }
  if(kind==='assassin'){ tone(80,.45,'square',.07); flash('loseFlash'); }
  if(kind==='clue'){ tone(880,.08,'sine'); setTimeout(()=>tone(1174,.08,'sine'),80); }
}
function flash(cls){ const d=document.createElement('div'); d.className=cls; document.body.appendChild(d); setTimeout(()=>d.remove(),850); }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function fmt(ms){ let s=Math.floor(ms/1000); const m=String(Math.floor(s/60)).padStart(2,'0'); s=String(s%60).padStart(2,'0'); return `${m}:${s}`; }

function charEmoji(id){ const c=state?.characters?.find(x=>x.id===id); return c?.emoji || '🕵️'; }
function charAccent(id){ const c=state?.characters?.find(x=>x.id===id); return c?.accent || '#71e2ff'; }
function me(){ return state?.players?.[myId]; }
function teamName(team){ return team === 'blue' ? 'Gold' : team === 'red' ? 'Black' : team === 'neutral' ? 'Blank' : team === 'assassin' ? 'Grey' : 'Spectator'; }
function teamUpper(team){ return teamName(team).toUpperCase(); }
function hasOnlineSpymaster(team){ return Object.values(state?.players || {}).some(p => p.online !== false && p.team === team && p.role === 'spymaster'); }
function spymasterName(team){ const p = Object.values(state?.players || {}).find(p => p.online !== false && p.team === team && p.role === 'spymaster'); return p?.name || null; }

function renderCharacters(){
  const list = [
    { id:'raiden', name:'Raiden', emoji:'🧙‍♂️', accent:'#71e2ff' },{ id:'viper', name:'Viper', emoji:'🐍', accent:'#9cff8c' },{ id:'nova', name:'Nova', emoji:'🚀', accent:'#ffd36e' },{ id:'phantom', name:'Phantom', emoji:'👻', accent:'#c9a7ff' },{ id:'spark', name:'Spark', emoji:'⚡', accent:'#ffef68' },{ id:'raven', name:'Raven', emoji:'🦅', accent:'#ff8aa8' },{ id:'pixel', name:'Pixel', emoji:'🎮', accent:'#7af7d7' },{ id:'titan', name:'Titan', emoji:'🦾', accent:'#ff9d5c' }
  ];
  $('characterPick').innerHTML = list.map(c=>`<div class="char ${c.id===selectedCharacter?'selected':''}" data-char="${c.id}" title="${c.name}" style="--a:${c.accent}"><span>${c.emoji}</span></div>`).join('');
  $('characterPick').querySelectorAll('.char').forEach(el=>el.onclick=()=>{selectedCharacter=el.dataset.char;renderCharacters();});
}

renderCharacters();

function setJoinButtonsReady(){
  const ready = !!(selectedTeamChoice && selectedRoleChoice && nameInput.value.trim());
  const cb = $('createBtn'), jb = $('joinBtn');
  if(cb) cb.disabled = !ready;
  if(jb) jb.disabled = !ready || !roomInput.value.trim();
}
function updateJoinSummary(){
  const box = $('joinSummary');
  if(!box) return;
  if(!selectedTeamChoice || !selectedRoleChoice){ box.classList.add('hidden'); box.textContent=''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<b>Selected:</b> ${teamName(selectedTeamChoice)} Team · ${selectedRoleChoice}`;
}
function openRolePopup(team){
  const overlay = $('roleOverlay');
  if(!overlay) return;
  const title = $('rolePopupTitle');
  const text = $('rolePopupText');
  if(team === 'spectator'){
    if(title) title.textContent = 'Join as spectator';
    if(text) text.textContent = 'Spectators can watch the game without guessing or giving clues.';
    document.querySelectorAll('.rolePick').forEach(b => b.classList.toggle('hidden', b.dataset.role !== 'spectator'));
  } else {
    if(title) title.textContent = `Choose your ${teamName(team)} role`;
    if(text) text.textContent = 'Pick Operative to guess cards, or Spymaster to give clues.';
    document.querySelectorAll('.rolePick').forEach(b => b.classList.toggle('hidden', b.dataset.role === 'spectator'));
  }
  overlay.classList.remove('hidden');
}
function closeRolePopup(){ const o=$('roleOverlay'); if(o) o.classList.add('hidden'); }
function setupJoinFlow(){
  const teamSel = $('team'), roleSel = $('role');
  document.querySelectorAll('.teamPick').forEach(btn=>{
    btn.onclick=()=>{
      selectedTeamChoice = btn.dataset.team;
      selectedRoleChoice = '';
      if(teamSel) teamSel.value = selectedTeamChoice;
      if(roleSel) roleSel.value = selectedTeamChoice === 'spectator' ? 'spectator' : 'operative';
      document.querySelectorAll('.teamPick').forEach(b=>b.classList.toggle('selected', b === btn));
      updateJoinSummary(); setJoinButtonsReady(); requestLobbyInfo(); openRolePopup(selectedTeamChoice);
    };
  });
  document.querySelectorAll('.rolePick').forEach(btn=>{
    btn.onclick=()=>{
      selectedRoleChoice = selectedTeamChoice === 'spectator' ? 'spectator' : btn.dataset.role;
      if(roleSel) roleSel.value = selectedRoleChoice;
      document.querySelectorAll('.rolePick').forEach(b=>b.classList.toggle('selected', b.dataset.role === selectedRoleChoice));
      closeRolePopup(); updateJoinSummary(); setJoinButtonsReady(); requestLobbyInfo();
    };
  });
  const close=$('closeRolePopup'); if(close) close.onclick=closeRolePopup;
  const overlay=$('roleOverlay'); if(overlay) overlay.onclick=e=>{ if(e.target===overlay) closeRolePopup(); };
  nameInput.addEventListener('input', setJoinButtonsReady);
  roomInput.addEventListener('input', setJoinButtonsReady);
}
setupJoinFlow();

function joinPayload(){
  localStorage.cc_name = nameInput.value.trim() || 'Agent';
  return { name:nameInput.value, team:$('team').value, role:$('role').value, character:selectedCharacter, playerKey };
}
function acceptJoinResponse(res){
  if(!res.ok) return toast(res.error);
  if(res.roomId){ roomInput.value = res.roomId; updateInviteFields(res.roomId); }
  if(res.playerKey){
    playerKey = res.playerKey;
    myId = res.playerKey;
    localStorage.cc_playerKey = res.playerKey;
  }
  // joinRoom can broadcast the room state before this callback reaches the tab.
  // Re-render immediately after receiving the real seat key so a new tab shows
  // its own chosen team/role instead of the old tab's saved seat.
  if(state){
    landing.classList.add('hidden');
    game.classList.remove('hidden');
    render();
  }
}
$('createBtn').onclick=()=> socket.emit('createRoom', joinPayload(), acceptJoinResponse);
$('joinBtn').onclick=()=> socket.emit('joinRoom', { ...joinPayload(), roomId:roomInput.value.trim().toUpperCase() }, acceptJoinResponse);

socket.on('connect',()=>{ myId = playerKey; });
socket.on('toast', toast);
socket.on('state', s=>{
  const before = state;
  const clueAccepted = before?.status === 'waiting-clue' && s.status === 'guessing' && before?.clue?.at !== s.clue?.at && s.clue;
  const turnChanged = before && before.turn !== s.turn;
  const newFinishedGame = before && before.status !== 'finished' && s.status === 'finished';
  if(clueAccepted || turnChanged || newFinishedGame){
    targetIds.clear();
    const cw = $('clueWord'); if(cw) cw.value = '';
  }
  state = s; myId = playerKey;
  if(landing && !landing.classList.contains('hidden')) { landing.classList.add('hidden'); game.classList.remove('hidden'); }
  if(before?.clue?.at !== s.clue?.at && s.clue) sound('clue');
  if(newFinishedGame) sound('gameWin');
  detectRevealSound(before, s);
  render();
  animateScoreChanges(before, s);
  animateNewReveals(before, s);
});

function detectRevealSound(before, now){
  if(!before) return;
  for(const c of now.board){
    const old = before.board.find(x=>x.id===c.id);
    if(old && !old.revealed && c.revealed){
      const p = me();
      if(c.color==='assassin') return sound('assassin');
      if(p && p.team !== 'spectator') sound(c.color===p.team?'win':'lose');
    }
  }
}


function updateScoreDisplay(gold, black){
  const goldNum = $('goldScoreNum'), blackNum = $('blackScoreNum');
  const goldBadge = $('goldScoreBadge'), blackBadge = $('blackScoreBadge');
  if(goldNum) goldNum.textContent = gold;
  if(blackNum) blackNum.textContent = black;
  if(goldBadge) goldBadge.setAttribute('aria-label', `Gold remaining cards ${gold}`);
  if(blackBadge) blackBadge.setAttribute('aria-label', `Black remaining cards ${black}`);
}
function animateScoreChanges(before, now){
  if(!before?.points || !now?.points) return;
  const changes = [
    { team:'blue', id:'goldScoreBadge', old:before.points.blue, val:now.points.blue },
    { team:'red', id:'blackScoreBadge', old:before.points.red, val:now.points.red }
  ];
  for(const c of changes){
    if(typeof c.old !== 'number' || typeof c.val !== 'number' || c.val === c.old) continue;
    const el = $(c.id); if(!el) continue;
    el.classList.remove('scoreDrop','scoreGain'); void el.offsetWidth;
    el.classList.add(c.val < c.old ? 'scoreDrop' : 'scoreGain');
    const delta = document.createElement('span');
    delta.className = 'scoreDelta';
    delta.textContent = c.val < c.old ? `-${c.old - c.val}` : `+${c.val - c.old}`;
    el.appendChild(delta);
    setTimeout(()=>{ el.classList.remove('scoreDrop','scoreGain'); delta.remove(); }, 950);
  }
}

function animateNewReveals(before, now){
  if(!before || !now?.board) return;
  for(const c of now.board){
    const old = before.board?.find(x=>x.id===c.id);
    if(old && !old.revealed && c.revealed && (c.color === 'blue' || c.color === 'red')){
      flyCardToTeamScore(c);
    }
  }
}
function flyCardToTeamScore(card){
  requestAnimationFrame(()=>{
    const src = document.querySelector(`.card[data-id="${card.id}"]`);
    const dest = card.color === 'blue' ? $('goldSideScore') : $('blackSideScore');
    if(!src || !dest) return;
    const a = src.getBoundingClientRect();
    const b = dest.getBoundingClientRect();
    const clone = document.createElement('div');
    clone.className = `flyingCard ${card.color === 'blue' ? 'flyGold' : 'flyBlack'}`;
    clone.textContent = card.word;
    clone.style.left = `${a.left}px`;
    clone.style.top = `${a.top}px`;
    clone.style.width = `${a.width}px`;
    clone.style.height = `${a.height}px`;
    document.body.appendChild(clone);
    const dx = b.left + b.width/2 - (a.left + a.width/2);
    const dy = b.top + b.height/2 - (a.top + a.height/2);
    clone.animate([
      { transform:'translate(0,0) scale(1)', opacity:.95, filter:'brightness(1)' },
      { transform:`translate(${dx*.55}px,${dy*.35-70}px) scale(.74)`, opacity:.9, filter:'brightness(1.35)' },
      { transform:`translate(${dx}px,${dy}px) scale(.18)`, opacity:0, filter:'brightness(1.8)' }
    ], { duration:850, easing:'cubic-bezier(.2,.8,.2,1)' }).onfinish = ()=> clone.remove();
  });
}
function renderWinModal(){
  const modal = $('winModal'); if(!modal) return;
  const won = state?.status === 'finished' && state?.winner;
  modal.classList.toggle('hidden', !won);
  if(!won){
    modal.classList.remove('docked','winBlue','winRed');
    if(winDockTimer){ clearTimeout(winDockTimer); winDockTimer = null; }
    lastWinKey = null;
    return;
  }
  const name = teamUpper(state.winner);
  $('winModalTitle').textContent = `${name} TEAM WON THE GAME!`;
  $('winModalText').textContent = 'Congratulations!';
  const key = `${state.id}-${state.round}-${state.winner}-${state.status}`;
  if(lastWinKey !== key){
    lastWinKey = key;
    modal.classList.remove('docked','winBlue','winRed');
    if(winDockTimer) clearTimeout(winDockTimer);
    winDockTimer = setTimeout(()=>{
      modal.classList.add('docked', state.winner === 'blue' ? 'winBlue' : 'winRed');
    }, 2000);
  }
}


function render(){
  const p = me();
  $('roomLabel').textContent = `Room ${state.id} · Round ${state.round}`;
  updateInviteFields(state.id);
  $('turnBadge').className = `badge ${state.turn}`; $('turnBadge').textContent = `${teamUpper(state.turn)} TURN`;
  $('clueBadge').className = 'badge gold';
  if(state.clue){
    const baseClue = `${state.clue.word.toUpperCase()} - ${state.clue.number} ${state.clue.number === 1 ? 'CARD' : 'CARDS'}`;
    $('clueBadge').textContent = state.clue.extraWord ? `${baseClue} · EXTRA: ${String(state.clue.extraWord).toUpperCase()}` : baseClue;
  } else {
    $('clueBadge').textContent = state.hintRequested ? 'ONE-TIME HINT REQUESTED' : 'WAITING FOR CLUE';
  }
  $('winnerBadge').className = state.winner ? `badge ${state.winner}` : 'hidden'; $('winnerBadge').textContent = state.winner ? `${teamUpper(state.winner)} WINS` : '';
  updateScoreDisplay(state.points?.blue ?? 9, state.points?.red ?? 9);
  const gs=$('goldSideScore'), bs=$('blackSideScore'); if(gs) gs.textContent=state.points?.blue ?? 9; if(bs) bs.textContent=state.points?.red ?? 9;
  const gp=$('goldPanel'), bp=$('blackPanel');
  if(gp) gp.classList.toggle('winnerPanel', state.winner === 'blue');
  if(bp) bp.classList.toggle('winnerPanel', state.winner === 'red');
  renderMe(); renderPlayers(); renderBoard(); renderPanels(); renderVoteConfirm(); renderLog(); renderWinModal();
}
function renderSeatCharacters(){ /* seat editing removed from in-game UI */ }
function renderMe(){
  const p=me(); if(!p) return;
  $('meCard').innerHTML = `<div class="player ${p.team}"><div class="avatar" style="background:${charAccent(p.character)}33">${charEmoji(p.character)}</div><div><b>${p.name}</b><span class="roleTag">${teamName(p.team)} · ${p.role}</span></div></div>`;
}
function renderPlayers(){
  const teams = { blue:{operative:[], spymaster:[]}, red:{operative:[], spymaster:[]}, spectator:{spectator:[]} };
  Object.values(state.players).forEach(p=>{
    const t = p.team || 'spectator';
    if(t === 'spectator') teams.spectator.spectator.push(p);
    else if(p.role === 'spymaster') teams[t].spymaster.push(p);
    else teams[t].operative.push(p);
  });
  function playerHtml(p){
    const offline = p.online === false;
    return `<div class="player ${p.team} ${offline?'offline':''}"><div class="avatar" style="background:${charAccent(p.character)}33">${charEmoji(p.character)}</div><div><b>${p.name} ${offline?'<span class="offlineIcon" title="Offline">📡</span>':''}</b><span class="roleTag">${p.role}${offline?' · offline':''}</span></div></div>`;
  }
  function empty(text){ return `<div class="emptyTeamSlot">${text}</div>`; }
  $('goldOperatives').innerHTML = teams.blue.operative.map(playerHtml).join('') || empty('No operatives yet');
  $('goldSpymasters').innerHTML = teams.blue.spymaster.map(playerHtml).join('') || empty('No spymaster yet');
  $('blackOperatives').innerHTML = teams.red.operative.map(playerHtml).join('') || empty('No operatives yet');
  $('blackSpymasters').innerHTML = teams.red.spymaster.map(playerHtml).join('') || empty('No spymaster yet');
  $('spectators').innerHTML = teams.spectator.spectator.map(playerHtml).join('') || empty('No spectators');
  const goldCount = teams.blue.operative.length + teams.blue.spymaster.length;
  const blackCount = teams.red.operative.length + teams.red.spymaster.length;
  const gc=$('goldPlayerCount'), bc=$('blackPlayerCount');
  if(gc) gc.textContent = `${goldCount} player${goldCount===1?'':'s'}`;
  if(bc) bc.textContent = `${blackCount} player${blackCount===1?'':'s'}`;
}
function syncClueCount(){
  const n = targetIds.size;
  const num = $('clueNumber');
  if(num) num.value = n;
  const btn = $('giveClueBtn');
  const p = me();
  const hintMode = !!(state?.hintRequested && p && state.hintRequested.team === p.team && p.team === state?.turn);
  const isCurrentSpy = p?.role==='spymaster' && p.team===state?.turn && (state?.status==='waiting-clue' || (hintMode && state?.status==='guessing'));
  if(btn) btn.disabled = !isCurrentSpy || (!hintMode && n < 1);
}

function teamOperativesOnline(team){
  return Object.values(state?.players || {}).filter(p=>p.online !== false && p.team===team && p.role==='operative');
}
function myMarkedIds(){
  const v = state?.voteInfo?.votes?.[myId];
  return Array.isArray(v) ? v : (v !== undefined && v !== null ? [v] : []);
}
function canConfirmVote(){ return false; }
function renderVoteConfirm(){
  const btn = $('confirmVoteBtn');
  if(btn) btn.classList.add('hidden');
}


function cardLengthClass(word){
  const l = String(word||'').length;
  if(l <= 6) return 'shortWord';
  if(l <= 9) return 'mediumWord';
  return 'longWord';
}

function revealHeroSvg(color){
  const cls = color === 'blue' ? 'goldHero' : color === 'red' ? 'blackHero' : color === 'neutral' ? 'blankHero' : 'greyHero';
  return `<div class="revealHero ${cls}" aria-hidden="true">
    <svg viewBox="0 0 220 140" role="img">
      <defs>
        <radialGradient id="heroGlow" cx="50%" cy="32%" r="70%"><stop offset="0%" stop-color="rgba(255,255,255,.65)"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/></radialGradient>
      </defs>
      <ellipse class="heroShadow" cx="110" cy="124" rx="62" ry="10"/>
      <circle class="heroHead" cx="110" cy="48" r="22"/>
      <path class="heroBody" d="M61 122c9-34 30-52 49-52s40 18 49 52z"/>
      <path class="heroCape" d="M68 122c-6-35 9-66 42-74 33 8 48 39 42 74-21-14-63-14-84 0z"/>
      <path class="heroShine" d="M82 36c24-22 62-15 75 12-25-13-55-10-75-12z"/>
      <circle class="heroSpark s1" cx="54" cy="36" r="5"/><circle class="heroSpark s2" cx="170" cy="50" r="4"/><circle class="heroSpark s3" cx="148" cy="22" r="3"/>
      <rect class="heroMask" x="82" y="43" width="56" height="10" rx="5"/>
      <circle class="heroGlowCircle" cx="110" cy="54" r="70" fill="url(#heroGlow)"/>
    </svg>
  </div>`;
}

function renderBoard(){
  const p=me(); const spy = p?.role==='spymaster';
  const marked = myMarkedIds();
  board.innerHTML = state.board.map(c=>{
    const showOrigin = state.status === 'finished';
    const colorClass = ((c.revealed || spy || showOrigin) && c.color) ? c.color : '';
    const target = c.clueTarget || targetIds.has(c.id);
    const voteCount = state.voteInfo?.counts?.[c.id] || 0;
    const agreed = state.voteInfo?.agreedCardId === c.id;
    const myVote = marked.includes(c.id);
    const voted = voteCount > 0;
    const playableSpyTarget = spy && p?.team===state.turn && state.status==='waiting-clue' && c.color===p.team && !c.revealed;
    const canConfirmThis = p?.role==='operative' && p.team===state.turn && state.status==='guessing' && myVote && !c.revealed;
    const voteBadge = voted && !c.revealed ? `<span class="voteBadge ${agreed?'agreed':''}">${voteCount}</span>` : '';
    const confirmMini = canConfirmThis ? `<span class="cardConfirm" data-confirm-id="${c.id}" title="Confirm ${c.word}">✓</span>` : '';
    const revealBadge = c.revealed ? revealHeroSvg(c.color) : '';
    return `<button class="card ${colorClass} ${c.revealed?'revealed':''} ${showOrigin && !c.revealed?'originShown':''} ${target?'target':''} ${playableSpyTarget?'spyPickable':''} ${voted?'voted':''} ${agreed?'agreed':''} ${myVote?'myVote':''}" data-id="${c.id}" title="${c.word}">${revealBadge}<span class="word ${cardLengthClass(c.word)}" style="--letters:${String(c.word).length}">${c.word}</span>${voteBadge}${confirmMini}</button>`;
  }).join('');
  board.querySelectorAll('.card').forEach(el=>{
    el.onclick=(ev)=>{
      if(ev.target.closest('.cardConfirm')) return;
      const id = Number(el.dataset.id); const card = state.board.find(c=>c.id===id); const p=me();
      if(!p || !card || card.revealed || state.status==='finished') return;
      if(p.role==='spymaster' && p.team===state.turn && state.status==='waiting-clue' && !(state?.hintRequested && state.hintRequested.team===p.team)){
        if(card.color !== p.team){ toast('Spymasters can only choose cards from their own team color.'); return; }
        targetIds.has(id) ? targetIds.delete(id) : targetIds.add(id);
        renderBoard(); syncClueCount(); return;
      }
      if(p.role==='operative' && p.team===state.turn && state.status==='guessing'){
        socket.emit('voteCard', { id });
      }
    };
  });
  board.querySelectorAll('.cardConfirm').forEach(btn=>{
    btn.onclick=(ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      socket.emit('confirmVote', { id:Number(btn.dataset.confirmId) });
    };
  });
  syncClueCount();
}
function renderPanels(){
  const p=me();
  const turnSpy = spymasterName(state.turn);
  const hintModeForSpy = !!(state?.hintRequested && p?.role==='spymaster' && state.hintRequested.team === p.team && p.team === state.turn);
  const isCurrentSpy=p?.role==='spymaster' && p.team===state.turn && (state.status==='waiting-clue' || hintModeForSpy);
  const isAnySpy=p?.role==='spymaster';
  const isOp=p?.role==='operative' && p.team===state.turn;
  const canClaim = p && p.team===state.turn && p.role!=='spymaster' && !hasOnlineSpymaster(state.turn) && state.status==='waiting-clue';
  $('spymasterPanel').classList.add('hidden');
  const opActive = !!(p?.role==='operative' && p.team===state.turn && (state.status==='guessing' || state.status==='waiting-clue'));
  const topActions = $('topOperativeActions');
  if(topActions) topActions.classList.toggle('hidden', !opActive);
  $('operativePanel').classList.toggle('hidden', !opActive);
  $('requestHintBtn').disabled = !(p?.role==='operative' && p.team===state.turn) || state.hintUsed[p?.team];
  $('endTurnBtn').disabled = !(p?.role==='operative' && p.team===state.turn && state.status==='guessing');

  const dock=$('bottomClueDock');
  if(dock){
    dock.classList.toggle('hidden', !isAnySpy);
    $('clueWord').disabled = !isCurrentSpy;
    $('clueNumber').readOnly = true;
    $('clueNumber').disabled = false;
    syncClueCount();
    if(isCurrentSpy){
      const hintMode = !!(state?.hintRequested && state.hintRequested.team === p.team);
      $('dockTitle').textContent = hintMode ? 'One-time hint requested' : 'Your turn: write the clue';
      $('dockHelp').textContent = hintMode ? 'Write only the extra hint. You do not need to select any cards.' : 'Click only your own color cards. The number increases automatically.';
    } else if(isAnySpy){
      $('dockTitle').textContent = 'Clue box waiting';
      $('dockHelp').textContent = state.status==='waiting-clue'
        ? `It is ${teamName(state.turn)} Team's clue turn. Only that team's spymaster can send now.`
        : 'A clue is already active. Wait for the operatives to finish guessing.';
    }
  }

  const newRound = $('newRoundBtn');
  if(newRound) newRound.classList.toggle('hidden', state.status !== 'finished');
  if(state.status === 'finished'){
    $('clueStatus').innerHTML = `<b>${teamUpper(state.winner)} wins!</b><br>Start a new game in this same room so the same lobby can keep playing.`;
  } else if(isCurrentSpy){
    $('clueStatus').innerHTML = `<b>Your clue box is at the bottom.</b><br>Click intended cards, then send the clue from the bottom bar.`;
  } else if(state.status==='waiting-clue'){
    if(turnSpy){
      $('clueStatus').innerHTML = `<b>Waiting for ${teamUpper(state.turn)} spymaster:</b><br>${turnSpy} must write the clue now.`;
    } else if(canClaim){
      $('clueStatus').innerHTML = `<b>No ${teamUpper(state.turn)} spymaster online.</b><br>Rejoin as that team's spymaster to claim it.`;
    } else {
      $('clueStatus').innerHTML = `<b>Waiting for clue.</b><br>Only the current team's spymaster can write it.`;
    }
  } else if(state.clue){
    const extra = state.status==='guessing' ? `<br><small>Vote on a card, then any active teammate can confirm their selected card. You may pass anytime.</small>` : '';
    const extraHint = state.clue.extraWord ? `<br><b>Extra hint:</b> ${String(state.clue.extraWord).toUpperCase()}` : '';
    $('clueStatus').innerHTML = `<b>Current clue:</b><br>${state.clue.word.toUpperCase()} - ${state.clue.number} ${Number(state.clue.number)===1?'CARD':'CARDS'}${extraHint}${extra}`;
  } else {
    $('clueStatus').innerHTML = '';
  }
}
function renderLog(){
  const html = state.log.slice().reverse().map(x=>`<div>${x}</div>`).join('');
  const mainLog = $('log');
  if(mainLog){
    mainLog.innerHTML = html;
    requestAnimationFrame(()=>{ mainLog.scrollTop = 0; });
  }
  const hiddenLog = $('logHidden');
  if(hiddenLog){
    hiddenLog.innerHTML = html;
    requestAnimationFrame(()=>{ hiddenLog.scrollTop = 0; });
  }
}

const switchBtn = $('switchBtn'); if(switchBtn) switchBtn.onclick=()=> socket.emit('switchSeat', { team:$('seatTeam')?.value, role:$('seatRole')?.value, character:$('seatCharacter')?.value });
const randomBtn = $('randomBtn'); if(randomBtn) randomBtn.onclick=()=> socket.emit('randomizeTeams');
const newGameBtn = $('newGameBtn'); if(newGameBtn) newGameBtn.onclick=()=> { if(confirm('Start a new board in this room?')) { targetIds.clear(); socket.emit('newGame'); } };
$('giveClueBtn').onclick=()=>{
  const targets = [...targetIds];
  const clueWord = $('clueWord').value.trim();
  const p = me();
  const hintMode = !!(state?.hintRequested && p && state.hintRequested.team === p.team);
  if(!clueWord){ toast('Write a clue word first.'); return; }
  if(!hintMode && targets.length < 1){ toast('Pick at least one of your team cards first.'); return; }
  socket.emit('giveClue', { word:clueWord, number:targets.length, targetIds:targets });
};
const newRoundBtn = $('newRoundBtn'); if(newRoundBtn) newRoundBtn.onclick=()=> { targetIds.clear(); socket.emit('newGame'); };
$('requestHintBtn').onclick=()=> socket.emit('requestHint');
$('endTurnBtn').onclick=()=> socket.emit('endTurn');
const confirmVoteBtn = $('confirmVoteBtn'); if(confirmVoteBtn) confirmVoteBtn.onclick=()=> socket.emit('confirmVote', { id: myMarkedIds()[0] });
const inviteBtn = $('inviteBtn'); if(inviteBtn) inviteBtn.onclick=async()=>{ updateInviteFields(state?.id || roomInput.value); const link=$('inviteLinkGame')?.value; if(link && navigator.clipboard){ try{ await navigator.clipboard.writeText(link); toast('Invite link copied.'); }catch{ toast('Invite link ready.'); } } else toast('Invite link ready.'); };
const topInviteBtn = $('topInviteBtn'); if(topInviteBtn) topInviteBtn.onclick=async()=>{ updateInviteFields(state?.id || roomInput.value); const link=$('topInviteLink')?.value; if(link && navigator.clipboard){ try{ await navigator.clipboard.writeText(link); toast('Invite link copied.'); }catch{ toast('Invite link ready.'); } } else toast('Invite link ready.'); };
const backToLobbyBtn = $('backToLobbyBtn');
if(backToLobbyBtn) backToLobbyBtn.onclick=()=>{
  const currentRoom = state?.id || roomInput.value.trim().toUpperCase();
  socket.emit('leaveToLobby', () => {
    state = null;
    targetIds.clear();
    lastRevealed.clear();
    playerKey = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    myId = playerKey;
    localStorage.cc_playerKey = playerKey;
    if(currentRoom) roomInput.value = currentRoom;
    selectedTeamChoice = '';
    selectedRoleChoice = '';
    document.querySelectorAll('.teamPick,.rolePick').forEach(b=>b.classList.remove('selected'));
    updateJoinSummary();
    setJoinButtonsReady();
    requestLobbyInfo();
    game.classList.add('hidden');
    landing.classList.remove('hidden');
    toast('Choose a new team or role, then join again.');
  });
};
setInterval(()=>{ if(!state) return; $('roundTime').textContent=fmt(Date.now()-state.roundStartedAt); $('gameTime').textContent=fmt(Date.now()-state.gameStartedAt); },500);
