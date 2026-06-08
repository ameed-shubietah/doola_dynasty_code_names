const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const WORDS_PATH = path.join(__dirname, 'data', 'words.json');
let WORDS = [];
try {
  WORDS = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8')).map(w => String(w).toUpperCase()).filter(Boolean);
} catch (err) {
  console.warn('Could not load data/words.json, using fallback words.', err.message);
  WORDS = ['ANCHOR','APPLE','ARCADE','ASTEROID','ATLAS','BALLOON','BAND','BERRY','BOTTLE','CASTLE','CASINO','CHEST','CLOUD','COMET','CRYSTAL','EARTH','ENGINE','FOREST','GOLD','HELMET','ISLAND','KING','LEMON','MAGICIAN','MARBLE','MERCURY','OCEAN','PAPER','PARROT','PLANET','PRINTER','ROBOT','SATELLITE','SCORPION','SHADOW','STORM','TOWER','TRAIN','UMBRELLA','WALRUS','WAVE'];
}
WORDS = [...new Set(WORDS)].filter(w => /^[A-Z][A-Z-]{1,20}$/.test(w));
if (WORDS.length < 25) throw new Error('Need at least 25 card words.');

// Codenames-style balance: the team that starts has 9 cards, the other team has 8, plus 7 blank cards and 1 grey danger card.
const CHARACTERS = [
  { id:'raiden', name:'Raiden', emoji:'🧙‍♂️', accent:'#71e2ff' },
  { id:'viper', name:'Viper', emoji:'🐍', accent:'#9cff8c' },
  { id:'nova', name:'Nova', emoji:'🚀', accent:'#ffd36e' },
  { id:'phantom', name:'Phantom', emoji:'👻', accent:'#c9a7ff' },
  { id:'spark', name:'Spark', emoji:'⚡', accent:'#ffef68' },
  { id:'raven', name:'Raven', emoji:'🦅', accent:'#ff8aa8' },
  { id:'pixel', name:'Pixel', emoji:'🎮', accent:'#7af7d7' },
  { id:'titan', name:'Titan', emoji:'🦾', accent:'#ff9d5c' }
];

function code() { return Math.random().toString(36).slice(2, 7).toUpperCase(); }
function shuffle(a) { return [...a].sort(() => Math.random() - 0.5); }
function cleanName(n) { return String(n || 'Agent').trim().slice(0, 18) || 'Agent'; }
function nameKey(n) { return cleanName(n).toLowerCase().replace(/\s+/g, ' '); }
function safeText(t, max=80) { return String(t || '').replace(/[<>]/g, '').trim().slice(0, max); }
function safePlayerKey(k) {
  const cleaned = String(k || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || ('p_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}
function freshPlayerKey(room) {
  let key;
  do { key = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  while (room.players[key]);
  return key;
}
function findPlayerBySocket(room, socketId) {
  return Object.values(room.players).find(p => p.socketId === socketId) || null;
}

function makeBoard(startingTeam='red') {
  const playable = WORDS.slice(0, Math.min(10000, WORDS.length));
  const words = shuffle(playable).slice(0, 25);
  const teamCounts = {
    blue: startingTeam === 'blue' ? 9 : 8,
    red: startingTeam === 'red' ? 9 : 8,
    neutral: 7,
    assassin: 1
  };
  const colors = [];
  for (let i=0; i<teamCounts.blue; i++) colors.push('blue');      // Gold team cards
  for (let i=0; i<teamCounts.red; i++) colors.push('red');        // Black team cards
  for (let i=0; i<teamCounts.neutral; i++) colors.push('neutral'); // Blank cards: skip turn only
  colors.push('assassin');                                         // Grey danger card: instant loss
  const shuffledColors = shuffle(colors);
  return words.map((word, i) => ({ id:i, word, color:shuffledColors[i], revealed:false, revealedBy:null, revealedById:null, clueTarget:false }));
}

function newRoom(id) {
  const startingTeam = Math.random() > 0.5 ? 'blue' : 'red';
  return {
    id,
    createdAt: Date.now(),
    gameStartedAt: Date.now(),
    roundStartedAt: Date.now(),
    round: 1,
    status: 'waiting-clue',
    turn: startingTeam,
    winner: null,
    players: {},
    board: makeBoard(startingTeam),
    clue: null,
    guessesThisTurn: 0,
    allowedGuesses: 0,
    hintUsed: { blue:false, red:false },
    hintRequested: null,
    votes: {},
    log: [`Game created. ${startingTeam === 'blue' ? 'GOLD' : 'BLACK'} starts.`]
  };
}


function roomLobbyInfo(room) {
  const players = Object.values(room.players || {});
  const online = players.filter(p => p.online !== false);
  const byTeam = t => online.filter(p => p.team === t);
  const spies = t => byTeam(t).filter(p => p.role === 'spymaster').map(p => p.name);
  return {
    ok: true,
    roomId: room.id,
    round: room.round,
    status: room.status,
    playersTotal: online.length,
    counts: {
      blue: byTeam('blue').length,
      red: byTeam('red').length,
      spectator: byTeam('spectator').length
    },
    spymasters: {
      blue: spies('blue'),
      red: spies('red')
    }
  };
}

function publicRoom(room, forPlayerKey=null) {
  const player = forPlayerKey ? room.players[forPlayerKey] : null;
  const isSpy = player && player.role === 'spymaster';
  return {
    id:room.id, createdAt:room.createdAt, gameStartedAt:room.gameStartedAt, roundStartedAt:room.roundStartedAt,
    round:room.round, status:room.status, turn:room.turn, winner:room.winner, clue:room.clue, points:counts(room),
    guessesThisTurn:room.guessesThisTurn, allowedGuesses:room.allowedGuesses || 0, voteInfo:voteInfo(room), hintUsed:room.hintUsed, hintRequested:room.hintRequested,
    players:room.players, characters:CHARACTERS, log:room.log.slice(-30),
    board: room.board.map(c => ({ id:c.id, word:c.word, revealed:c.revealed, revealedBy:c.revealedBy, revealedById:c.revealedById, clueTarget:(isSpy ? c.clueTarget : false), color: (isSpy || c.revealed || room.status === 'finished') ? c.color : null }))
  };
}


function activeOperatives(room, team) {
  return Object.values(room.players).filter(p => p.online !== false && p.team === team && p.role === 'operative');
}
function voteInfo(room) {
  const ops = activeOperatives(room, room.turn);
  const votes = room.votes || {};
  const counts = {};
  Object.values(votes).forEach(v => {
    const ids = Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
    ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  });
  let agreedCardId = null;
  if (Object.keys(counts).length) {
    agreedCardId = Number(Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]);
  }
  return { votes, counts, totalOperatives: ops.length, agreedCardId };
}


function emitRoom(room) {
  Object.values(room.players).forEach(p => {
    if (p.online !== false && p.socketId) io.to(p.socketId).emit('state', publicRoom(room, p.id));
  });
}
function counts(room) {
  return { blue: room.board.filter(c=>c.color==='blue'&&!c.revealed).length, red: room.board.filter(c=>c.color==='red'&&!c.revealed).length };
}
function removeVoteForCard(room, cardId) {
  room.votes = room.votes || {};
  for (const [pid, value] of Object.entries(room.votes)) {
    const arr = Array.isArray(value) ? value.filter(id => id !== cardId) : (value === cardId ? [] : [value]);
    if (arr.length) room.votes[pid] = arr;
    else delete room.votes[pid];
  }
}
function switchTurn(room) {
  room.turn = room.turn === 'blue' ? 'red' : 'blue';
  room.status = 'waiting-clue';
  room.clue = null;
  room.guessesThisTurn = 0;
  room.allowedGuesses = 0;
  room.hintRequested = null;
  room.votes = {};
  room.round += 1;
  room.roundStartedAt = Date.now();
  room.board.forEach(c => c.clueTarget = false);
  room.log.push(`Turn changed to ${room.turn === 'blue' ? 'GOLD' : 'BLACK'}.`);
}
function finish(room, winner, reason) {
  room.status = 'finished'; room.winner = winner; room.log.push(`${winner === 'blue' ? 'GOLD' : winner === 'red' ? 'BLACK' : winner.toUpperCase()} wins. ${reason}`);
}
function hasTeamSpymaster(room, team) { return Object.values(room.players).some(p => p.online !== false && p.team === team && p.role === 'spymaster'); }
function playerCanAct(room, p) { return p && p.team === room.turn && room.status !== 'finished'; }

io.on('connection', socket => {
  socket.on('getRoomInfo', ({ roomId }={}, cb=()=>{}) => {
    const room = rooms.get(String(roomId||'').toUpperCase());
    if (!room) return cb({ ok:false, error:'Room not found.' });
    cb(roomLobbyInfo(room));
  });

  socket.on('createRoom', ({ name, team='blue', role='operative', character='raiden', playerKey }={}, cb=()=>{}) => {
    const roomId = code();
    const room = newRoom(roomId);
    rooms.set(roomId, room);
    joinRoom(socket, room, { name, team, role, character, playerKey });
    cb({ ok:true, roomId, playerKey: socket.data.playerKey });
  });

  socket.on('joinRoom', ({ roomId, name, team='spectator', role='operative', character='raiden', playerKey }={}, cb=()=>{}) => {
    const room = rooms.get(String(roomId||'').toUpperCase());
    if (!room) return cb({ ok:false, error:'Room not found.' });
    joinRoom(socket, room, { name, team, role, character, playerKey });
    cb({ ok:true, roomId:room.id, playerKey: socket.data.playerKey });
  });

  function joinRoom(socket, room, { name, team, role, character, playerKey }) {
    socket.join(room.id);
    let key = safePlayerKey(playerKey);
    let existing = room.players[key];
    const incomingName = cleanName(name);
    const incomingNameKey = nameKey(incomingName);
    const char = CHARACTERS.find(c=>c.id===character) ? character : CHARACTERS[Math.floor(Math.random()*CHARACTERS.length)].id;

    team = ['blue','red','spectator'].includes(team) ? team : 'spectator';
    role = ['operative','spymaster','spectator'].includes(role) ? role : 'operative';
    if (team === 'spectator') role = 'spectator';

    // Same browser in a new tab shares localStorage, so it sends the same playerKey.
    // If that player is still online, treat this as a NEW seat using the selected team/role.
    // If that player is offline, restore their old seat so refresh/reconnect/host return works.
    if (existing && existing.online !== false) {
      key = freshPlayerKey(room);
      existing = null;
    }

    // Reconnects are restored by the browser/session playerKey only.
    // Do not match by displayed name, because two different people may use the same name
    // on the same team with different roles.

    socket.data.roomId = room.id;
    socket.data.playerKey = key;

    if (existing) {
      existing.socketId = socket.id;
      existing.online = true;
      existing.lastSeenAt = Date.now();
      existing.name = incomingName;
      if (CHARACTERS.find(c=>c.id===character)) existing.character = character;
      // Keep same-name seats allowed. Only this exact playerKey seat is restored.
      room.log.push(`${existing.name} rejoined the room and restored their seat.`);
      emitRoom(room);
      return;
    }

    if (role === 'spymaster' && team !== 'spectator' && hasTeamSpymaster(room, team)) role = 'operative';
    room.players[key] = { id:key, socketId:socket.id, name:incomingName, team, role, character:char, joinedAt:Date.now(), lastSeenAt:Date.now(), online:true };
    // Same displayed names are allowed for different people/roles.
    room.log.push(`${room.players[key].name} joined as ${team === 'blue' ? 'Gold' : team === 'red' ? 'Black' : 'Spectator'} ${role}.`);
    emitRoom(room);
  }

  socket.on('switchSeat', ({ team, role, character }={}) => {
    const room = getPlayerRoom(socket.id); if (!room) return;
    const p = getPlayerBySocket(room, socket.id);
    team = ['blue','red','spectator'].includes(team) ? team : p.team;
    role = ['operative','spymaster','spectator'].includes(role) ? role : p.role;
    if (team === 'spectator') role = 'spectator';
    if (role === 'spymaster' && p.role !== 'spymaster' && team !== 'spectator' && hasTeamSpymaster(room, team)) {
      socket.emit('toast', 'That team already has an online spymaster. You can only claim spymaster if that spymaster is offline.'); return;
    }
    p.team = team; p.role = role;
    if (CHARACTERS.find(c=>c.id===character)) p.character = character;
    room.log.push(`${p.name} switched to ${team === 'blue' ? 'Gold' : team === 'red' ? 'Black' : 'Spectator'} ${role}.`);
    emitRoom(room);
  });

  socket.on('randomizeTeams', () => {
    const room = getPlayerRoom(socket.id); if (!room) return;
    const players = Object.values(room.players).filter(p=>p.team!=='spectator');
    shuffle(players).forEach((p,i)=>{ p.team = i%2 ? 'red':'blue'; if(p.role==='spymaster') p.role='operative'; });
    room.log.push('Teams randomized. Choose spymasters again.');
    emitRoom(room);
  });

  socket.on('newGame', () => {
    const room = getPlayerRoom(socket.id); if (!room) return;
    const players = room.players;
    const fresh = newRoom(room.id);
    fresh.players = players;
    rooms.set(room.id, fresh);
    emitRoom(fresh);
  });

  socket.on('requestHint', () => {
    const room = getPlayerRoom(socket.id); if (!room) return;
    const p = getPlayerBySocket(room, socket.id);
    if (!playerCanAct(room,p) || p.role !== 'operative') return;
    if (room.hintUsed[p.team]) return socket.emit('toast', 'Your team already used its one extra hint.');
    if (room.status !== 'waiting-clue' && room.status !== 'guessing') return;
    room.hintUsed[p.team] = true;
    room.hintRequested = { team:p.team, by:p.name, at:Date.now(), previousStatus:room.status };
    // Keep the current guessing phase alive so operatives can still mark and confirm cards while waiting for the extra hint.
    room.log.push(`${p.team === 'blue' ? 'GOLD' : 'BLACK'} requested their one extra hint. Operatives can keep guessing while waiting.`);
    emitRoom(room);
  });

  socket.on('giveClue', ({ word, number, targetIds=[] }={}) => {
    const room = getPlayerRoom(socket.id); if (!room) return;
    const p = getPlayerBySocket(room, socket.id);
    if (!playerCanAct(room,p) || p.role !== 'spymaster') return;
    const isExtraHint = !!(room.hintRequested && room.hintRequested.team === p.team);
    if (room.status !== 'waiting-clue' && !(isExtraHint && room.status === 'guessing')) return;
    word = safeText(word, 24).replace(/\s+/g, '-');
    const cleanTargets = [...new Set((Array.isArray(targetIds) ? targetIds : []).map(x => parseInt(x, 10)))]
      .filter(id => room.board.some(c => c.id === id && !c.revealed && c.color === p.team))
      .slice(0, 9);
    number = cleanTargets.length;
    if (!word) return socket.emit('toast', 'Write a clue word first.');
    if (!isExtraHint && number < 1) return socket.emit('toast', 'Choose at least one card from your own team color.');
    room.board.forEach(c => c.clueTarget = false);
    cleanTargets.forEach(id => { const card = room.board.find(c=>c.id===id && !c.revealed && c.color === p.team); if(card) card.clueTarget = true; });
    if (isExtraHint) {
      // Show the extra hint on top, but keep the original clue allowance.
      const previous = room.clue || {};
      room.clue = { ...previous, extraWord:word, extraBy:p.name, extraAt:Date.now() };
    } else {
      room.clue = { word, number, by:p.name, team:p.team, targetIds:cleanTargets, extraHint:false, at:Date.now() };
      room.guessesThisTurn = 0;
      room.allowedGuesses = number + 1;
    }
    room.status = 'guessing'; room.votes = room.votes || {}; room.roundStartedAt = Date.now(); room.hintRequested = null;
    room.log.push(isExtraHint
      ? `${p.name} gave one-time hint ${word.toUpperCase()} for ${p.team === 'blue' ? 'GOLD' : 'BLACK'}.`
      : `${p.name} gave ${word.toUpperCase()} - ${number} ${number === 1 ? 'CARD' : 'CARDS'} for ${p.team === 'blue' ? 'GOLD' : 'BLACK'}.`);
    emitRoom(room);
  });

  socket.on('voteCard', ({ id }={}) => {
    const room = getPlayerRoom(socket.id); if (!room) return;
    const p = getPlayerBySocket(room, socket.id);
    if (!playerCanAct(room,p) || p.role !== 'operative' || room.status !== 'guessing') return;
    const card = room.board.find(c=>c.id===parseInt(id,10));
    if (!card || card.revealed) return;
    room.votes = room.votes || {};
    const current = Array.isArray(room.votes[p.id]) ? room.votes[p.id] : (room.votes[p.id] !== undefined ? [room.votes[p.id]] : []);
    const idx = current.indexOf(card.id);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(card.id);
    if (current.length) room.votes[p.id] = current;
    else delete room.votes[p.id];
    emitRoom(room);
  });

  socket.on('confirmVote', ({ id }={}) => {
    const room = getPlayerRoom(socket.id); if (!room) return;
    const p = getPlayerBySocket(room, socket.id);
    if (!playerCanAct(room,p) || p.role !== 'operative' || room.status !== 'guessing') return;
    const marked = Array.isArray(room.votes?.[p.id]) ? room.votes[p.id] : (room.votes?.[p.id] !== undefined ? [room.votes[p.id]] : []);
    const chosenId = parseInt(id ?? marked[0], 10);
    if (Number.isNaN(chosenId) || !marked.includes(chosenId)) return socket.emit('toast', 'Choose a card first, then confirm it.');
    const card = room.board.find(c=>c.id===chosenId);
    if (!card || card.revealed) { if(!Number.isNaN(chosenId)) removeVoteForCard(room, chosenId); emitRoom(room); return; }

    card.revealed = true; card.revealedBy = p.name; card.revealedById = p.id;
    const team = p.team;
    room.guessesThisTurn += 1;
    removeVoteForCard(room, card.id);

    const pickerTeamName = team === 'blue' ? 'GOLD' : 'BLACK';
    const cardTeamName = card.color === 'blue' ? 'GOLD' : card.color === 'red' ? 'BLACK' : card.color === 'neutral' ? 'BLANK' : 'GREY';

    if (card.color === 'assassin') {
      room.log.push(`☠️ ${pickerTeamName} confirmed ${card.word}: GREY danger card. ${pickerTeamName} loses.`);
      finish(room, team === 'blue' ? 'red' : 'blue', `${p.name} confirmed the grey danger card.`); emitRoom(room); return;
    }

    const leftAfterReveal = counts(room);
    if (leftAfterReveal.blue === 0) { room.log.push(`✅ GOLD confirmed ${card.word}: correct. GOLD reached 0.`); finish(room, 'blue', 'GOLD reached 0 remaining cards.'); emitRoom(room); return; }
    if (leftAfterReveal.red === 0) { room.log.push(`✅ BLACK confirmed ${card.word}: correct. BLACK reached 0.`); finish(room, 'red', 'BLACK reached 0 remaining cards.'); emitRoom(room); return; }

    if (card.color === 'neutral') {
      room.log.push(`❌ ${pickerTeamName} confirmed ${card.word}: BLANK card. Turn skipped, no points lost.`);
      switchTurn(room); emitRoom(room); return;
    }
    if (card.color !== team) {
      room.log.push(`❌ ${pickerTeamName} confirmed ${card.word}: wrong, it was ${cardTeamName}. ${cardTeamName} gets the point and the turn is skipped.`);
      switchTurn(room); emitRoom(room); return;
    }

    const maxGuesses = room.allowedGuesses || ((room.clue?.number || 0) + 1);
    const remainingBonus = Math.max(0, maxGuesses - room.guessesThisTurn);
    room.log.push(`✅ ${pickerTeamName} confirmed ${card.word}: correct. ${pickerTeamName} has ${counts(room)[team]} left.`);
    if (remainingBonus <= 0) {
      room.log.push(`✅ ${pickerTeamName} completed the clue guesses and the bonus guess window ended.`);
      switchTurn(room);
    }
    emitRoom(room);
  });

  socket.on('endTurn', () => { const room = getPlayerRoom(socket.id); if (!room) return; const p=getPlayerBySocket(room, socket.id); if(playerCanAct(room,p) && room.status==='guessing') { room.log.push(`${p.name} passed the turn.`); switchTurn(room); emitRoom(room); } });

  socket.on('leaveToLobby', (cb=()=>{}) => {
    const room = getPlayerRoom(socket.id);
    if (!room) return cb({ ok:true });
    const p = getPlayerBySocket(room, socket.id);
    if (p) {
      room.log.push(`${p.name} left the table and returned to the lobby.`);
      delete room.players[p.id];
      room.votes = room.votes || {};
      delete room.votes[p.id];
    }
    socket.leave(room.id);
    socket.data.roomId = null;
    socket.data.playerKey = null;
    emitRoom(room);
    cb({ ok:true, roomId: room.id });
  });

  socket.on('disconnect', () => {
    const room = getPlayerRoom(socket.id); if (!room) return;
    const p = findPlayerBySocket(room, socket.id);
    if(p){ p.online=false; p.socketId=null; p.lastSeenAt=Date.now(); room.log.push(`${p.name} disconnected. The room stays alive and they can rejoin with code ${room.id}.`); emitRoom(room); }
  });
});

function getPlayerRoom(socketId) {
  const directRoom = rooms.get(io.sockets.sockets.get(socketId)?.data?.roomId);
  if (directRoom) return directRoom;
  for (const room of rooms.values()) if (findPlayerBySocket(room, socketId)) return room;
  return null;
}
function getPlayerBySocket(room, socketId) { return findPlayerBySocket(room, socketId); }
server.listen(PORT, () => console.log(`Doola's Dynasty Code Names running on http://localhost:${PORT}`));
