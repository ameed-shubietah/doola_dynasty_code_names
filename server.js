const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {cors: {origin: '*'}});
app.use(express.json({limit: '2mb'}));
app.use((req, res, next) => {
    res.removeHeader('X-Frame-Options');
    res.setHeader(
        'Content-Security-Policy',
        "frame-ancestors 'self' https://discord.com https://*.discord.com https://discordapp.com https://*.discordapp.com https://*.discordsays.com"
    );
    next();
});

app.post('/api/discord-token', async (req, res) => {
    try {
        const code = String(req.body?.code || '').trim();
        if (!code) return res.status(400).json({ok: false, error: 'Missing Discord OAuth code.'});

        const clientId = process.env.DISCORD_CLIENT_ID || '1514895948197793893';
        const clientSecret = process.env.DISCORD_CLIENT_SECRET;
        if (!clientSecret) {
            return res.status(500).json({ok: false, error: 'DISCORD_CLIENT_SECRET is not set on the server.'});
        }

        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code
            })
        });

        const data = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !data.access_token) {
            return res.status(tokenRes.status || 500).json({
                ok: false,
                error: data.error_description || data.error || 'Discord token exchange failed.'
            });
        }

        res.json({
            ok: true,
            access_token: data.access_token,
            token_type: data.token_type,
            expires_in: data.expires_in,
            scope: data.scope
        });
    } catch (err) {
        res.status(500).json({ok: false, error: err?.message || 'Discord token exchange failed.'});
    }
});

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
    WORDS = ['ANCHOR', 'APPLE', 'ARCADE', 'ASTEROID', 'ATLAS', 'BALLOON', 'BAND', 'BERRY', 'BOTTLE', 'CASTLE', 'CASINO', 'CHEST', 'CLOUD', 'COMET', 'CRYSTAL', 'EARTH', 'ENGINE', 'FOREST', 'GOLD', 'HELMET', 'ISLAND', 'KING', 'LEMON', 'MAGICIAN', 'MARBLE', 'MERCURY', 'OCEAN', 'PAPER', 'PARROT', 'PLANET', 'PRINTER', 'ROBOT', 'SATELLITE', 'SCORPION', 'SHADOW', 'STORM', 'TOWER', 'TRAIN', 'UMBRELLA', 'WALRUS', 'WAVE'];
}
WORDS = [...new Set(WORDS)].filter(w => /^[A-Z][A-Z-]{1,20}$/.test(w));
if (WORDS.length < 25) throw new Error('Need at least 25 card words.');

// Codenames-style balance: the team that starts has 9 cards, the other team has 8, plus 7 blank cards and 1 grey danger card.
// Board words are pulled from small semantic clusters first, then filled from data/words.json.
// This keeps the board harder because several cards can feel related without changing any gameplay logic.
const SEMANTIC_CLUSTERS = [
    ['KING', 'QUEEN', 'CROWN', 'THRONE', 'PALACE', 'ROYAL', 'MONARCH', 'CASTLE'],
    ['OCEAN', 'SEA', 'WAVE', 'BEACH', 'ISLAND', 'REEF', 'ANCHOR', 'SHIP', 'SAIL'],
    ['DOCTOR', 'NURSE', 'HOSPITAL', 'PHARMACY', 'MEDICINE', 'PATIENT', 'CLINIC'],
    ['TRAIN', 'STATION', 'TRACK', 'ENGINE', 'RAIL', 'TICKET', 'PLATFORM'],
    ['PLANE', 'PILOT', 'AIRPORT', 'ROCKET', 'SATELLITE', 'COMET', 'ASTEROID'],
    ['SCHOOL', 'TEACHER', 'STUDENT', 'BOOK', 'PAPER', 'PENCIL', 'CLASS'],
    ['PHONE', 'SCREEN', 'KEYBOARD', 'ROBOT', 'COMPUTER', 'PIXEL', 'PRINTER'],
    ['GOLD', 'SILVER', 'DIAMOND', 'RUBY', 'CRYSTAL', 'MARBLE', 'JEWEL'],
    ['FOREST', 'TREE', 'LEAF', 'GRASS', 'FLOWER', 'ROOT', 'MOSS'],
    ['DESERT', 'SAND', 'OASIS', 'CAMEL', 'PYRAMID', 'SUN', 'DUST'],
    ['FOOD', 'BREAD', 'CHEESE', 'APPLE', 'LEMON', 'MANGO', 'JUICE', 'SPICE'],
    ['SPORT', 'GOAL', 'BALL', 'COURT', 'ARENA', 'TEAM', 'MATCH'],
    ['MUSIC', 'BAND', 'PIANO', 'GUITAR', 'DRUM', 'SONG', 'ORCHESTRA'],
    ['ANIMAL', 'DOG', 'CAT', 'ELEPHANT', 'MONKEY', 'DRAGON', 'VIPER', 'RAVEN'],
    ['WEATHER', 'CLOUD', 'STORM', 'RAIN', 'LIGHTNING', 'SNOW', 'FROST'],
    ['MONEY', 'BANK', 'CASINO', 'CARD', 'CASH', 'VAULT', 'SAFE'],
    ['MAGIC', 'WIZARD', 'ORACLE', 'PHANTOM', 'SHADOW', 'SPELL', 'CRYSTAL'],
    ['HOUSE', 'ROOF', 'DOOR', 'WINDOW', 'KITCHEN', 'BED', 'TABLE'],
    ['BODY', 'HAND', 'ARM', 'LEG', 'EYE', 'HEART', 'BLOOD'],
    ['CITY', 'MAYOR', 'STREET', 'TOWER', 'BRIDGE', 'MARKET', 'HOTEL']
];

function themedWordsFromBank(bank, count = 25) {
    const available = new Set(bank);
    const chosen = [];
    const add = w => {
        if (available.has(w) && !chosen.includes(w) && chosen.length < count) chosen.push(w);
    };
    const clusters = shuffle(SEMANTIC_CLUSTERS.map(group => group.filter(w => available.has(w))).filter(group => group.length >= 2));
    for (const group of clusters) {
        if (chosen.length >= count) break;
        const take = Math.min(group.length, 2 + Math.floor(Math.random() * 3));
        shuffle(group).slice(0, take).forEach(add);
    }
    shuffle(bank).forEach(add);
    return chosen.slice(0, count);
}

const CHARACTERS = [
    {id: 'raiden', name: 'Raiden', emoji: '🧙‍♂️', accent: '#71e2ff'},
    {id: 'viper', name: 'Viper', emoji: '🐍', accent: '#9cff8c'},
    {id: 'nova', name: 'Nova', emoji: '🚀', accent: '#ffd36e'},
    {id: 'phantom', name: 'Phantom', emoji: '👻', accent: '#c9a7ff'},
    {id: 'spark', name: 'Spark', emoji: '⚡', accent: '#ffef68'},
    {id: 'raven', name: 'Raven', emoji: '🦅', accent: '#ff8aa8'},
    {id: 'pixel', name: 'Pixel', emoji: '🎮', accent: '#7af7d7'},
    {id: 'titan', name: 'Titan', emoji: '🦾', accent: '#ff9d5c'},
    {id: 'monarch', name: 'Monarch', emoji: '👑', accent: '#ffd36e'},
    {id: 'ninja', name: 'Ninja', emoji: '🥷', accent: '#c8c8d1'},
    {id: 'dragon', name: 'Dragon', emoji: '🐉', accent: '#ff7b5f'},
    {id: 'oracle', name: 'Oracle', emoji: '🔮', accent: '#b58cff'}
];

function code() {
    return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function shuffle(a) {
    return [...a].sort(() => Math.random() - 0.5);
}

function cleanName(n) {
    return String(n || 'Agent').replace(/[<>]/g, '').trim().slice(0, 32) || 'Agent';
}

function nameKey(n) {
    return cleanName(n).toLowerCase().replace(/\s+/g, ' ');
}

function safeText(t, max = 80) {
    return String(t || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function safePlayerKey(k) {
    const cleaned = String(k || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    return cleaned || ('p_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}

function makeAdminToken() {
    return 'adm_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isAdminPlayer(room, p) {
    return !!(p && p.isAdmin === true);
}

function canAdmin(room, socketId) {
    const p = getPlayerBySocket(room, socketId);
    return isAdminPlayer(room, p);
}

function freshPlayerKey(room) {
    let key;
    do {
        key = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    while (room.players[key]);
    return key;
}

function findPlayerBySocket(room, socketId) {
    return Object.values(room.players).find(p => p.socketId === socketId) || null;
}

function publicPlayers(players) {
    const out = {};
    for (const [id, p] of Object.entries(players || {})) {
        out[id] = {
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            discordId: p.discordId,
            team: p.team,
            role: p.role,
            character: p.character,
            joinedAt: p.joinedAt,
            lastSeenAt: p.lastSeenAt,
            online: p.online,
            isAdmin: !!p.isAdmin
        };
    }
    return out;
}

function makeBoard(startingTeam = 'red') {
    const playable = WORDS.slice(0, Math.min(10000, WORDS.length));
    const words = themedWordsFromBank(playable, 25);
    const teamCounts = {
        blue: startingTeam === 'blue' ? 9 : 8,
        red: startingTeam === 'red' ? 9 : 8,
        neutral: 7,
        assassin: 1
    };
    const colors = [];
    for (let i = 0; i < teamCounts.blue; i++) colors.push('blue');      // Gold team cards
    for (let i = 0; i < teamCounts.red; i++) colors.push('red');        // Black team cards
    for (let i = 0; i < teamCounts.neutral; i++) colors.push('neutral'); // Blank cards: skip turn only
    colors.push('assassin');                                         // Grey danger card: instant loss
    const shuffledColors = shuffle(colors);
    return words.map((word, i) => ({
        id: i,
        word,
        color: shuffledColors[i],
        revealed: false,
        revealedBy: null,
        revealedById: null,
        clueTarget: false
    }));
}

function newRoom(id) {
    const startingTeam = Math.random() > 0.5 ? 'blue' : 'red';
    return {
        id,
        createdAt: Date.now(),
        gameStartedAt: Date.now(),
        roundStartedAt: Date.now(),
        round: 1,
        status: 'lobby',
        turn: startingTeam,
        winner: null,
        players: {},
        board: makeBoard(startingTeam),
        clue: null,
        guessesThisTurn: 0,
        allowedGuesses: 0,
        hintUsed: {blue: false, red: false},
        hintRequested: null,
        votes: {},
        adminToken: makeAdminToken(),
        adminRequests: [],
        log: []
    };
}


function roomLobbyInfo(room) {
    const players = Object.values(room.players || {});
    const online = players.filter(p => p.online !== false);
    const byTeamRole = (team, role) => {
        const seen = new Set();
        return online.filter(p => p.team === team && p.role === role).filter(p => {
            const key = p.discordId || p.id || p.socketId || p.name;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).map(p => ({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            discordId: p.discordId,
            character: p.character,
            isAdmin: !!p.isAdmin
        }));
    };
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
        roles: {
            blue: {operative: byTeamRole('blue', 'operative'), spymaster: byTeamRole('blue', 'spymaster')},
            red: {operative: byTeamRole('red', 'operative'), spymaster: byTeamRole('red', 'spymaster')},
            spectator: {spectator: byTeamRole('spectator', 'spectator')}
        },
        spymasters: {
            blue: spies('blue'),
            red: spies('red')
        }
    };
}

function publicRoom(room, forPlayerKey = null) {
    const player = forPlayerKey ? room.players[forPlayerKey] : null;
    const isSpy = player && player.role === 'spymaster';
    return {
        id: room.id,
        createdAt: room.createdAt,
        gameStartedAt: room.gameStartedAt,
        roundStartedAt: room.roundStartedAt,
        round: room.round,
        status: room.status,
        turn: room.turn,
        winner: room.winner,
        clue: room.clue,
        points: counts(room),
        adminOnline: Object.values(room.players).some(p => p.online !== false && p.isAdmin),
        guessesThisTurn: room.guessesThisTurn,
        allowedGuesses: room.allowedGuesses || 0,
        voteInfo: voteInfo(room),
        hintUsed: room.hintUsed,
        hintRequested: room.hintRequested,
        players: publicPlayers(room.players),
        characters: CHARACTERS,
        log: room.log.slice(-30),
        board: room.board.map(c => ({
            id: c.id,
            word: c.word,
            revealed: c.revealed,
            revealedBy: c.revealedBy,
            revealedById: c.revealedById,
            clueTarget: (isSpy ? c.clueTarget : false),
            color: (isSpy || c.revealed || room.status === 'finished') ? c.color : null
        }))
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
        ids.forEach(id => {
            counts[id] = (counts[id] || 0) + 1;
        });
    });
    let agreedCardId = null;
    if (Object.keys(counts).length) {
        agreedCardId = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    }
    return {votes, counts, totalOperatives: ops.length, agreedCardId};
}


function emitRoom(room) {
    Object.values(room.players).forEach(p => {
        if (p.online !== false && p.socketId) io.to(p.socketId).emit('state', publicRoom(room, p.id));
    });
    // Also update players who are still on the homepage/lobby preview before joining.
    io.to(`preview:${room.id}`).emit('lobbyInfo', roomLobbyInfo(room));
}

function counts(room) {
    return {
        blue: room.board.filter(c => c.color === 'blue' && !c.revealed).length,
        red: room.board.filter(c => c.color === 'red' && !c.revealed).length
    };
}

function resetRoomTable(room, message = 'Table reset with a fresh board.') {
    const startingTeam = Math.random() > 0.5 ? 'blue' : 'red';
    room.round += 1;
    room.status = 'waiting-clue';
    room.turn = startingTeam;
    room.winner = null;
    room.board = makeBoard(startingTeam);
    room.clue = null;
    room.guessesThisTurn = 0;
    room.allowedGuesses = 0;
    room.hintUsed = {blue: false, red: false};
    room.hintRequested = null;
    room.votes = {};
    room.roundStartedAt = Date.now();
    room.gameStartedAt = Date.now();
    // Reset table means a clean board + clean game log.
    room.log = [];
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

}

function finish(room, winner, reason) {
    room.status = 'finished';
    room.winner = winner;
    room.log.push(`${winner === 'blue' ? 'GOLD' : winner === 'red' ? 'BLACK' : winner.toUpperCase()} wins. ${reason}`);
}

function hasTeamSpymaster(room, team) {
    return Object.values(room.players).some(p => p.online !== false && p.team === team && p.role === 'spymaster');
}

function playerCanAct(room, p) {
    return p && p.team === room.turn && room.status !== 'finished';
}

function adminActionLabel(action) {
    return action === 'resetTable' ? 'Reset Table'
        : action === 'shuffleTeams' ? 'Shuffle Teams'
            : action === 'changeWordList' ? 'Change Word List'
                : 'Admin Action';
}

function runAdminTableAction(room, action, actorName = 'Admin') {
    if (action === 'resetTable') {
        resetRoomTable(room, `${actorName} reset the table.`);
        return true;
    }
    if (action === 'changeWordList') {
        resetRoomTable(room, `${actorName} changed the word list.`);
        return true;
    }
    if (action === 'shuffleTeams') {
        const players = shuffle(Object.values(room.players).filter(p => p.online !== false && p.team !== 'spectator'));
        players.forEach((p, i) => {
            p.team = i % 2 ? 'red' : 'blue';
        });
        room.votes = {};
        room.log.push(`${actorName} shuffled online players between GOLD and BLACK.`);
        return true;
    }
    return false;
}

function emitAdminRequest(room, request) {
    Object.values(room.players).forEach(p => {
        if (p.online !== false && p.socketId && p.isAdmin) io.to(p.socketId).emit('adminRequest', request);
    });
}

io.on('connection', socket => {
    socket.on('getRoomInfo', ({roomId} = {}, cb = () => {
    }) => {
        const id = String(roomId || '').toUpperCase();
        const room = rooms.get(id);
        if (!room) return cb({ok: false, error: 'Room not found.'});
        socket.join(`preview:${id}`);
        cb(roomLobbyInfo(room));
    });

    socket.on('createRoom', ({
                                 name,
                                 avatar = '',
                                 discordId = '',
                                 team = 'blue',
                                 role = 'operative',
                                 character = 'raiden',
                                 playerKey
                             } = {}, cb = () => {
    }) => {
        const roomId = code();
        const room = newRoom(roomId);
        rooms.set(roomId, room);
        const joined = joinRoom(socket, room, {
            name,
            avatar,
            discordId,
            team,
            role,
            character,
            playerKey,
            forceAdmin: true,
            adminToken: room.adminToken
        });
        if (joined?.ok === false) return cb(joined);
        cb({ok: true, roomId, playerKey: socket.data.playerKey, adminToken: room.adminToken});
    });

    socket.on('joinRoom', ({
                               roomId,
                               name,
                               avatar = '',
                               discordId = '',
                               team = 'spectator',
                               role = 'operative',
                               character = 'raiden',
                               playerKey,
                               adminToken
                           } = {}, cb = () => {
    }) => {
        const room = rooms.get(String(roomId || '').toUpperCase());
        if (!room) return cb({ok: false, error: 'Room not found.'});
        const joined = joinRoom(socket, room, {name, avatar, discordId, team, role, character, playerKey, adminToken});
        if (joined?.ok === false) return cb(joined);
        cb({
            ok: true,
            roomId: room.id,
            playerKey: socket.data.playerKey,
            adminToken: (adminToken && adminToken === room.adminToken) ? room.adminToken : undefined
        });
    });

    socket.on('joinOrCreateActivityRoom', ({
                                               roomId,
                                               activityId,
                                               name,
                                               avatar = '',
                                               discordId = '',
                                               team = 'spectator',
                                               role = 'operative',
                                               character = 'raiden',
                                               playerKey,
                                               adminToken
                                           } = {}, cb = () => {
    }) => {
        let id = String(roomId || activityId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
        if (!id) id = code();
        if (id.length > 5) id = id.slice(0, 5);
        let room = rooms.get(id);
        let created = false;
        if (!room) {
            room = newRoom(id);
            rooms.set(id, room);
            created = true;
        }
        const forceAdmin = created;
        const joined = joinRoom(socket, room, {
            name,
            avatar,
            discordId,
            team,
            role,
            character,
            playerKey,
            adminToken: forceAdmin ? room.adminToken : adminToken,
            forceAdmin
        });
        if (joined?.ok === false) return cb(joined);
        cb({
            ok: true,
            roomId: room.id,
            playerKey: socket.data.playerKey,
            adminToken: forceAdmin ? room.adminToken : ((adminToken && adminToken === room.adminToken) ? room.adminToken : undefined)
        });
    });


    socket.on('updateDiscordIdentity', ({name, avatar = '', discordId = ''} = {}, cb = () => {
    }) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return cb({ok: false, error: 'No active room.'});
        const p = getPlayerBySocket(room, socket.id);
        if (!p) return cb({ok: false, error: 'No active player.'});

        const cleanDiscordId = safeText(discordId, 80);
        const cleanAvatar = safeText(avatar, 120000);
        const cleanDisplayName = cleanName(name || p.name);

        p.name = cleanDisplayName;
        if (cleanAvatar) {
            p.avatar = cleanAvatar;
            p.character = '';
        }
        if (cleanDiscordId) p.discordId = cleanDiscordId;

        let finalKey = p.id;
        if (cleanDiscordId) {
            const desiredKey = safePlayerKey('d_' + cleanDiscordId);
            for (const [pid, oldPlayer] of Object.entries(room.players)) {
                if (pid !== p.id && (oldPlayer.discordId === cleanDiscordId || oldPlayer.socketId === socket.id)) {
                    if (oldPlayer.isAdmin && !p.isAdmin) {
                        p.isAdmin = true;
                        p.adminToken = room.adminToken;
                    }
                    delete room.players[pid];
                    delete room.votes?.[pid];
                }
            }
            if (desiredKey !== p.id) {
                const oldKey = p.id;
                p.id = desiredKey;
                finalKey = desiredKey;
                room.players[desiredKey] = p;
                delete room.players[oldKey];
                if (room.votes?.[oldKey]) {
                    room.votes[desiredKey] = room.votes[oldKey];
                    delete room.votes[oldKey];
                }
            }
        }

        socket.data.playerKey = finalKey;
        cb({ok: true, playerKey: finalKey});
        io.to(socket.id).emit('identityKey', {playerKey: finalKey});
        emitRoom(room);
    });


    socket.on('updatePlayerProfile', ({name, avatar = '', character = ''} = {}, cb = () => {
    }) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return cb({ok: false, error: 'No active room.'});
        const p = getPlayerBySocket(room, socket.id);
        if (!p) return cb({ok: false, error: 'No active player.'});

        const nextName = cleanName(name || p.name);
        const nextAvatar = safeText(avatar, 120000);
        const usingCustomAvatar = !!nextAvatar;
        let nextCharacter = usingCustomAvatar ? '' : p.character;
        if (!usingCustomAvatar && CHARACTERS.find(c => c.id === character)) nextCharacter = character;

        const taken = nextCharacter ? Object.values(room.players || {}).find(old =>
            old.online !== false &&
            old.id !== p.id &&
            old.socketId !== socket.id &&
            old.character === nextCharacter &&
            !old.avatar &&
            (!p.discordId || old.discordId !== p.discordId)
        ) : null;
        if (taken) {
            const charName = (CHARACTERS.find(c => c.id === nextCharacter)?.name || 'That character');
            return cb({ok: false, error: `${charName} is already taken by ${taken.name}.`, character: p.character});
        }

        p.name = nextName;
        p.avatar = nextAvatar;
        p.character = nextCharacter;
        p.lastSeenAt = Date.now();
        cb({ok: true, playerKey: p.id});
        emitRoom(room);
    });

    function joinRoom(socket, room, {
        name,
        avatar = '',
        discordId = '',
        team,
        role,
        character,
        playerKey,
        adminToken,
        forceAdmin = false
    }) {
        socket.join(room.id);
        let key = safePlayerKey(playerKey);
        let existing = room.players[key];
        const previousKey = socket.data.playerKey && String(socket.data.playerKey);
        let previousPlayer = previousKey && previousKey !== key ? room.players[previousKey] : null;
        const incomingName = cleanName(name);
        const incomingNameKey = nameKey(incomingName);
        avatar = safeText(avatar, 120000);
        discordId = safeText(discordId, 80);

        // Browser tabs share localStorage, but each tab is a separate player when there is no Discord ID.
        // Split an already-online same-key seat BEFORE checking character availability, otherwise the
        // old seat can accidentally bypass the taken-character check and hide other players.
        if (existing && existing.online !== false && existing.socketId !== socket.id && !discordId && !String(key).startsWith('d_')) {
            key = freshPlayerKey(room);
            existing = null;
            previousPlayer = null;
        }

        const usingCustomAvatar = !!avatar;
        let char = usingCustomAvatar ? '' : (CHARACTERS.find(c => c.id === character) ? character : CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id);
        const charTakenByOther = candidate => !!(candidate && Object.values(room.players || {}).find(old =>
            old.online !== false &&
            old.character === candidate &&
            !old.avatar &&
            old.id !== key &&
            old.socketId !== socket.id &&
            (!discordId || old.discordId !== discordId)
        ));
        if (char && charTakenByOther(char)) {
            const freeCharacter = CHARACTERS.find(c => !charTakenByOther(c.id));
            char = freeCharacter ? freeCharacter.id : '';
        }

        team = ['blue', 'red', 'spectator'].includes(team) ? team : 'spectator';
        role = ['operative', 'spymaster', 'spectator'].includes(role) ? role : 'operative';
        if (team === 'spectator') role = 'spectator';
        if (role === 'spymaster' && team !== 'spectator') {
            const occupyingSpy = Object.values(room.players || {}).find(old =>
                old.online !== false &&
                old.team === team &&
                old.role === 'spymaster' &&
                old.id !== key &&
                old.socketId !== socket.id &&
                (!discordId || old.discordId !== discordId)
            );
            if (occupyingSpy) {
                return {ok: false, error: `${team === 'blue' ? 'Gold' : 'Black'} Team already has a spymaster.`};
            }
        }

        // Same browser in a new tab shares localStorage, so it sends the same playerKey.
        // If that player is still online, treat this as a NEW seat using the selected team/role.
        // If that player is offline, restore their old seat so refresh/reconnect/host return works.
        if (discordId) {
            for (const [pid, oldPlayer] of Object.entries(room.players)) {
                if (pid !== key && oldPlayer.discordId && oldPlayer.discordId === discordId) {
                    // Same Discord user can only occupy one seat. Moving roles replaces the old seat.
                    if (oldPlayer.isAdmin && !forceAdmin) adminToken = room.adminToken;
                    delete room.players[pid];
                    delete room.votes?.[pid];
                }
            }
            existing = room.players[key];
        }

        // If the same open Discord frame clicks Join again with a different fallback key, move the same seat.
        // This prevents one user from appearing in several team/role blocks.
        if (previousPlayer && !existing) {
            if (previousPlayer.isAdmin && !forceAdmin) adminToken = room.adminToken;
            delete room.players[previousKey];
            delete room.votes?.[previousKey];
            previousPlayer.id = key;
            room.players[key] = previousPlayer;
            existing = previousPlayer;
        }

        // Extra safety: same socket can never keep old seats in the same room.
        for (const [pid, oldPlayer] of Object.entries(room.players)) {
            if (pid !== key && oldPlayer.socketId === socket.id) {
                if (oldPlayer.isAdmin && !forceAdmin) adminToken = room.adminToken;
                delete room.players[pid];
                delete room.votes?.[pid];
            }
        }
        existing = room.players[key];

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
            existing.avatar = avatar;
            if (discordId) existing.discordId = discordId;
            existing.team = team;
            existing.role = role;
            existing.character = usingCustomAvatar ? '' : char;
            if (adminToken && adminToken === room.adminToken) {
                existing.isAdmin = true;
                existing.adminToken = room.adminToken;
            }
            // Keep same-name seats allowed. Only this exact playerKey seat is restored.
            emitRoom(room);
            return {ok: true};
        }

        // Only the original room creator/admin-token holder becomes admin. Becoming spymaster never gives admin power.
        const isAdmin = !!forceAdmin || !!(adminToken && adminToken === room.adminToken);
        room.players[key] = {
            id: key,
            socketId: socket.id,
            name: incomingName,
            avatar,
            discordId,
            team,
            role,
            character: char,
            joinedAt: Date.now(),
            lastSeenAt: Date.now(),
            online: true,
            isAdmin,
            adminToken: isAdmin ? room.adminToken : undefined
        };
        // Same displayed names are allowed for different people/roles.
        emitRoom(room);
        return {ok: true};
    }

    socket.on('switchSeat', ({team, role, character} = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!canAdmin(room, socket.id)) return socket.emit('toast', 'Only the room admin can move players during the game.');
        team = ['blue', 'red', 'spectator'].includes(team) ? team : p.team;
        role = ['operative', 'spymaster', 'spectator'].includes(role) ? role : p.role;
        if (team === 'spectator') role = 'spectator';
        p.team = team;
        p.role = role;
        if (CHARACTERS.find(c => c.id === character)) p.character = character;
        room.log.push(`${p.name} switched to ${team === 'blue' ? 'Gold' : team === 'red' ? 'Black' : 'Spectator'} ${role}.`);
        emitRoom(room);
    });

    socket.on('randomizeTeams', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!canAdmin(room, socket.id) && p?.role !== 'spymaster') return socket.emit('toast', 'Only the admin and spymasters can shuffle teams.');
        if (runAdminTableAction(room, 'shuffleTeams', p?.name || 'Admin')) emitRoom(room);
    });

    socket.on('shuffleTeams', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!canAdmin(room, socket.id) && p?.role !== 'spymaster') return socket.emit('toast', 'Only the admin and spymasters can shuffle teams.');
        if (runAdminTableAction(room, 'shuffleTeams', p?.name || 'Admin')) emitRoom(room);
    });


    socket.on('startGame', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!canAdmin(room, socket.id)) return socket.emit('toast', 'Only the room admin can start the game.');
        if (room.status !== 'lobby') return socket.emit('toast', 'Game already started.');
        room.status = 'waiting-clue';
        room.roundStartedAt = Date.now();
        room.gameStartedAt = Date.now();
        room.log = [];
        emitRoom(room);
    });

    socket.on('newGame', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const players = room.players;
        const adminToken = room.adminToken;
        const fresh = newRoom(room.id);
        fresh.status = 'waiting-clue';
        fresh.log = [];
        fresh.players = players;
        fresh.adminToken = adminToken;
        rooms.set(room.id, fresh);
        emitRoom(fresh);
    });

    socket.on('resetTable', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!canAdmin(room, socket.id) && p?.role !== 'spymaster') return socket.emit('toast', 'Only the admin and spymasters can reset the table.');
        if (runAdminTableAction(room, 'resetTable', p?.name || 'Admin')) emitRoom(room);
    });

    socket.on('changeWordList', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!canAdmin(room, socket.id) && p?.role !== 'spymaster') return socket.emit('toast', 'Only the admin and spymasters can change the word list.');
        if (runAdminTableAction(room, 'changeWordList', p?.name || 'Admin')) emitRoom(room);
    });

    socket.on('adminActionRequest', ({action} = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!p) return;
        action = ['resetTable', 'shuffleTeams', 'changeWordList'].includes(action) ? action : '';
        if (!action) return;
        if (canAdmin(room, socket.id)) {
            if (runAdminTableAction(room, action, p.name || 'Admin')) emitRoom(room);
            return;
        }
        const admins = Object.values(room.players).filter(x => x.online !== false && x.isAdmin && x.socketId);
        if (!admins.length) return socket.emit('toast', 'No admin is online right now.');
        const request = {
            requestId: 'req_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
            action,
            label: adminActionLabel(action),
            fromId: p.id,
            fromName: p.name,
            at: Date.now()
        };
        room.adminRequests = (room.adminRequests || []).filter(r => Date.now() - r.at < 5 * 60 * 1000);
        room.adminRequests.push(request);
        emitAdminRequest(room, request);
        socket.emit('toast', `${request.label} request sent to admin.`);
    });

    socket.on('adminRequestDecision', ({requestId, approved} = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room || !canAdmin(room, socket.id)) return;
        const admin = getPlayerBySocket(room, socket.id);
        const idx = (room.adminRequests || []).findIndex(r => r.requestId === requestId);
        if (idx < 0) return socket.emit('toast', 'That admin request is no longer available.');
        const request = room.adminRequests.splice(idx, 1)[0];
        const requester = room.players[request.fromId];
        if (!approved) {
            if (requester?.socketId) io.to(requester.socketId).emit('toast', `Admin declined ${request.label}.`);
            return;
        }
        if (runAdminTableAction(room, request.action, admin?.name || 'Admin')) {
            room.log.push(`${admin?.name || 'Admin'} approved ${request.label} requested by ${request.fromName}.`);
            if (requester?.socketId) io.to(requester.socketId).emit('toast', `Admin approved ${request.label}.`);
            emitRoom(room);
        }
    });

    socket.on('adminUpdatePlayer', ({playerId, action, team, role} = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room || !canAdmin(room, socket.id)) return;
        const actor = getPlayerBySocket(room, socket.id);
        const target = room.players[String(playerId || '')];
        if (!target) return;
        if (target.isAdmin && target.id !== actor?.id) return socket.emit('toast', 'The room admin cannot be moved or kicked by anyone else.');
        if (action === 'kick') {
            if (target.isAdmin) return socket.emit('toast', 'The room admin cannot be kicked.');
            if (target.socketId) io.to(target.socketId).emit('kicked', {
                roomId: room.id,
                message: 'You were kicked from the room by the admin. You can join back if you want.'
            });
            room.log.push(`Admin kicked ${target.name}.`);
            delete room.votes?.[target.id];
            delete room.players[target.id];
            emitRoom(room);
            return;
        }
        if (action === 'assignAdmin') {
            target.isAdmin = true;
            target.adminToken = room.adminToken;
            if (target.socketId) io.to(target.socketId).emit('toast', 'You are now an admin.');
            socket.emit('toast', `${target.name} is now an admin.`);
            room.log.push(`Admin assigned admin access to ${target.name}.`);
            emitRoom(room);
            return;
        }
        if (action === 'move') {
            team = ['blue', 'red', 'spectator'].includes(team) ? team : target.team;
            role = ['operative', 'spymaster', 'spectator'].includes(role) ? role : target.role;
            if (team === 'spectator') role = 'spectator';
            if (role === 'spymaster' && team !== 'spectator') {
                const existingSpy = Object.values(room.players || {}).find(p => p.online !== false && p.id !== target.id && p.team === team && p.role === 'spymaster');
                if (existingSpy) return socket.emit('toast', `${team === 'blue' ? 'Gold' : 'Black'} Team already has a spymaster.`);
            }
            target.team = team;
            target.role = role;
            delete room.votes?.[target.id];
            room.log.push(`Admin moved ${target.name} to ${team === 'blue' ? 'Gold' : team === 'red' ? 'Black' : 'Spectator'} ${role}.`);
            emitRoom(room);
        }
    });

    socket.on('requestHint', () => {
    });

    socket.on('giveClue', ({word, number, targetIds = []} = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!playerCanAct(room, p) || p.role !== 'spymaster') return;
        const isExtraHint = false;
        if (room.status !== 'waiting-clue') return;
        word = safeText(word, 24).replace(/\s+/g, '-');
        const cleanTargets = [...new Set((Array.isArray(targetIds) ? targetIds : []).map(x => parseInt(x, 10)))]
            .filter(id => room.board.some(c => c.id === id && !c.revealed && c.color === p.team))
            .slice(0, 9);
        number = cleanTargets.length;
        if (!word) return socket.emit('toast', 'Write a clue word first.');
        if (!isExtraHint && number < 1) return socket.emit('toast', 'Choose at least one card from your own team color.');
        room.board.forEach(c => c.clueTarget = false);
        cleanTargets.forEach(id => {
            const card = room.board.find(c => c.id === id && !c.revealed && c.color === p.team);
            if (card) card.clueTarget = true;
        });
        room.clue = {
            word,
            number,
            by: p.name,
            avatar: p.avatar || '',
            team: p.team,
            targetIds: cleanTargets,
            extraHint: false,
            at: Date.now()
        };
        room.guessesThisTurn = 0;
        room.allowedGuesses = number + 1;
        room.status = 'guessing';
        room.votes = room.votes || {};
        room.roundStartedAt = Date.now();
        room.hintRequested = null;
        room.log.push(`HINT|${p.team}|${word.toUpperCase()}|${number || (room.clue?.number || 0)}|${p.name}|${p.avatar || ''}|${p.character || ''}`);
        emitRoom(room);
    });

    socket.on('voteCard', ({id} = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!playerCanAct(room, p) || p.role !== 'operative' || room.status !== 'guessing') return;
        const card = room.board.find(c => c.id === parseInt(id, 10));
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

    socket.on('confirmVote', ({id} = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!playerCanAct(room, p) || p.role !== 'operative' || room.status !== 'guessing') return;
        const marked = Array.isArray(room.votes?.[p.id]) ? room.votes[p.id] : (room.votes?.[p.id] !== undefined ? [room.votes[p.id]] : []);
        const chosenId = parseInt(id ?? marked[0], 10);
        if (Number.isNaN(chosenId) || !marked.includes(chosenId)) return socket.emit('toast', 'Choose a card first, then confirm it.');
        const card = room.board.find(c => c.id === chosenId);
        if (!card || card.revealed) {
            if (!Number.isNaN(chosenId)) removeVoteForCard(room, chosenId);
            emitRoom(room);
            return;
        }

        card.revealed = true;
        card.revealedBy = p.name;
        card.revealedById = p.id;
        const team = p.team;
        room.guessesThisTurn += 1;
        removeVoteForCard(room, card.id);

        const pickerTeamName = team === 'blue' ? 'GOLD' : 'BLACK';
        const cardTeamName = card.color === 'blue' ? 'GOLD' : card.color === 'red' ? 'BLACK' : card.color === 'neutral' ? 'EMPTY' : 'DANGER';
        room.log.push(`PICK|${team}|${card.color}|${card.word}|${p.name}|${p.avatar || ''}|${p.character || ''}`);

        if (card.color === 'assassin') {

            finish(room, team === 'blue' ? 'red' : 'blue', `${p.name} confirmed the grey danger card.`);
            emitRoom(room);
            return;
        }

        const leftAfterReveal = counts(room);
        if (leftAfterReveal.blue === 0) {
            finish(room, 'blue', 'GOLD reached 0 remaining cards.');
            emitRoom(room);
            return;
        }
        if (leftAfterReveal.red === 0) {
            finish(room, 'red', 'BLACK reached 0 remaining cards.');
            emitRoom(room);
            return;
        }

        if (card.color === 'neutral') {

            switchTurn(room);
            emitRoom(room);
            return;
        }
        if (card.color !== team) {

            switchTurn(room);
            emitRoom(room);
            return;
        }

        const maxGuesses = room.allowedGuesses || ((room.clue?.number || 0) + 1);
        const remainingBonus = Math.max(0, maxGuesses - room.guessesThisTurn);

        if (remainingBonus <= 0) {

            switchTurn(room);
        }
        emitRoom(room);
    });

    socket.on('endTurn', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (playerCanAct(room, p) && room.status === 'guessing') {
            room.log.push(`PASS|${p.team}|${p.name}|${p.avatar || ''}|${p.character || ''}`);
            switchTurn(room);
            emitRoom(room);
        }
    });

    socket.on('leaveToLobby', (cb = () => {
    }) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return cb({ok: true});
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
        cb({ok: true, roomId: room.id});
    });

    socket.on('disconnect', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = findPlayerBySocket(room, socket.id);
        if (p) {
            p.online = false;
            p.socketId = null;
            p.lastSeenAt = Date.now();
            room.log.push(`${p.name} disconnected. The room stays alive and they can rejoin with code ${room.id}.`);
            emitRoom(room);
        }
    });
});

function getPlayerRoom(socketId) {
    const directRoom = rooms.get(io.sockets.sockets.get(socketId)?.data?.roomId);
    if (directRoom) return directRoom;
    for (const room of rooms.values()) if (findPlayerBySocket(room, socketId)) return room;
    return null;
}

function getPlayerBySocket(room, socketId) {
    return findPlayerBySocket(room, socketId);
}

server.listen(PORT, () => console.log(`Doola's Dynasty Code Names running on http://localhost:${PORT}`));
