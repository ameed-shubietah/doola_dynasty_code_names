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

function randomWordsFromBank(bank, count = 25) {
    return shuffle(bank).slice(0, count);
}

function clueGroupKey(group) {
    if (group?.key) return group.key;
    return [...new Set((group?.words || []).map(w => String(w).toUpperCase()))].sort().join('|');
}

function clueGroupsForBank(bank) {
    const available = new Set(bank);
    return shuffle(BOT_CLUE_GROUPS || [])
        .map(group => ({
            ...group,
            key: clueGroupKey(group),
            availableWords: [...new Set((group.words || []).filter(w => available.has(w)))]
        }))
        .filter(group => group.availableWords.length >= 2 && group.clue);
}

function singlePlayerWordsForColors(bank, colors) {
    const words = Array(colors.length).fill('');
    const used = new Set();
    const groups = clueGroupsForBank(bank);
    const teamSlots = team => shuffle(colors.map((color, i) => color === team ? i : -1).filter(i => i >= 0));

    const placeTeamClusters = team => {
        const slots = teamSlots(team);
        const usedGroupKeys = new Set();
        for (const group of groups) {
            if (slots.length < 2) break;
            if (usedGroupKeys.has(group.key)) continue;
            const candidates = shuffle(group.availableWords.filter(w => !used.has(w)));
            if (candidates.length < 2) continue;
            const take = Math.min(slots.length, candidates.length, 2 + Math.floor(Math.random() * 3));
            if (take < 2) continue;
            for (const word of candidates.slice(0, take)) {
                const idx = slots.shift();
                words[idx] = word;
                used.add(word);
            }
            usedGroupKeys.add(group.key);
            if (Math.random() < .42) break;
        }
    };

    placeTeamClusters('blue');
    placeTeamClusters('red');

    const remaining = shuffle(bank.filter(w => !used.has(w)));
    for (let i = 0; i < words.length; i++) {
        if (!words[i]) {
            words[i] = remaining.shift() || shuffle(bank)[0];
            used.add(words[i]);
        }
    }
    return words;
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

function makeBoard(startingTeam = 'red', wordMode = 'themed') {
    const playable = WORDS.slice(0, Math.min(10000, WORDS.length));
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
    const words = wordMode === 'full'
        ? singlePlayerWordsForColors(playable, shuffledColors)
        : themedWordsFromBank(playable, 25);
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
        singlePlayer: false,
        singlePlayerDifficulty: 'medium',
        singlePlayerUsedClues: {blue: [], red: []},
        singlePlayerUsedClueGroups: {blue: [], red: []},
        botTimer: null,
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
    const canSeeClueTargets = !!(isSpy && player.team === room.turn);
    return {
        id: room.id,
        createdAt: room.createdAt,
        gameStartedAt: room.gameStartedAt,
        roundStartedAt: room.roundStartedAt,
        round: room.round,
        status: room.status,
        turn: room.turn,
        winner: room.winner,
        clue: publicClue(room, player),
        singlePlayer: !!room.singlePlayer,
        points: counts(room),
        adminOnline: Object.values(room.players).some(p => p.online !== false && p.isAdmin),
        guessesThisTurn: room.guessesThisTurn,
        allowedGuesses: room.allowedGuesses || 0,
        voteInfo: voteInfo(room, player),
        hintUsed: room.hintUsed,
        hintRequested: room.hintRequested,
        players: publicPlayers(room.players),
        characters: CHARACTERS,
        log: publicLog(room, player),
        board: room.board.map(c => ({
            id: c.id,
            word: c.word,
            revealed: c.revealed,
            revealedBy: c.revealedBy,
            revealedById: c.revealedById,
            clueTarget: (canSeeClueTargets ? c.clueTarget : false),
            color: (isSpy || c.revealed || room.status === 'finished') ? c.color : null
        }))
    };
}


function activeOperatives(room, team) {
    return Object.values(room.players).filter(p => p.online !== false && p.team === team && p.role === 'operative');
}

function voteInfo(room, viewer = null) {
    const ops = activeOperatives(room, room.turn);
    const votes = room.votes || {};
    if (room.singlePlayer && viewer && viewer.team !== room.turn) {
        return {votes: {}, counts: {}, totalOperatives: ops.length, agreedCardId: null};
    }
    if (viewer?.role === 'spymaster') {
        return {votes: {}, counts: {}, totalOperatives: ops.length, agreedCardId: null};
    }
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

function publicClue(room, player) {
    if (!room.clue) return null;
    if (room.singlePlayer && player && room.clue.team !== player.team) return null;
    return room.clue;
}

function publicLog(room, player) {
    const lines = room.log.slice(-30);
    // In single-player, keep the current clue private via publicClue(), but show
    // both sides' clue history in the game log so the bot turn is understandable.
    return lines;
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
    const startingTeam = room.singlePlayer ? 'blue' : (Math.random() > 0.5 ? 'blue' : 'red');
    if (room.botTimer) clearTimeout(room.botTimer);
    room.round += 1;
    room.status = 'waiting-clue';
    room.turn = startingTeam;
    room.winner = null;
    room.board = makeBoard(startingTeam, room.singlePlayer ? 'full' : 'themed');
    room.clue = null;
    room.guessesThisTurn = 0;
    room.allowedGuesses = 0;
    room.hintUsed = {blue: false, red: false};
    room.hintRequested = null;
    room.votes = {};
    room.singlePlayerUsedClues = {blue: [], red: []};
    room.singlePlayerUsedClueGroups = {blue: [], red: []};
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

const SINGLE_BOT_IDS = {
    blackBot: 'single_black_bot'
};

const BOT_CLUE_CATEGORY_SPECS = [
    {id: 'royalty', clues: ['ROYALTY', 'KINGDOM', 'MONARCHY', 'CROWNED', 'NOBILITY', 'PALACE'], words: ['KING', 'QUEEN', 'PRINCE', 'PRINCESS', 'EMPEROR', 'CAESAR', 'NAPOLEON', 'CLEOPATRA', 'CROWN', 'THRONE', 'PALACE', 'CASTLE', 'KINGDOM', 'KNIGHT']},
    {id: 'water', clues: ['AQUATIC', 'MARINE', 'SEASIDE', 'NAUTICAL', 'OCEANIC', 'WATER'], words: ['OCEAN', 'SEA', 'WAVE', 'WATER', 'RIVER', 'LAKE', 'BEACH', 'ISLAND', 'HARBOR', 'FOUNTAIN', 'WATERFALL', 'PUDDLE', 'SWAMP', 'NILE', 'ATLANTIS', 'SAIL', 'ANCHOR', 'RUDDER', 'BOAT', 'SHIP', 'FERRY', 'SAILOR']},
    {id: 'sea-life', clues: ['AQUARIUM', 'SEAFOOD', 'REEF', 'UNDERSEA', 'FISHERY', 'DIVING'], words: ['FISH', 'SHARK', 'WHALE', 'DOLPHIN', 'OCTOPUS', 'SQUID', 'LOBSTER', 'CRAB', 'SALMON', 'TURTLE', 'PENGUIN', 'GOOSE', 'DUCK', 'SWAN']},
    {id: 'animals', clues: ['ANIMALS', 'WILDLIFE', 'BEASTS', 'ZOO', 'MAMMALS', 'FAUNA'], words: ['DOG', 'CAT', 'HORSE', 'COW', 'GOAT', 'SHEEP', 'PIG', 'CHICKEN', 'ROOSTER', 'TURKEY', 'RABBIT', 'MOUSE', 'RAT', 'DEER', 'BEAR', 'WOLF', 'FOX', 'LION', 'TIGER', 'GORILLA', 'MONKEY', 'ELEPHANT', 'GIRAFFE', 'ZEBRA', 'KANGAROO', 'KOALA', 'PANDA', 'CAMEL', 'BEAVER']},
    {id: 'birds', clues: ['BIRD', 'FEATHER', 'AVIAN', 'WINGED', 'FLOCK', 'FLYING'], words: ['BIRD', 'FEATHER', 'EAGLE', 'HAWK', 'FALCON', 'CROW', 'RAVEN', 'PARROT', 'OWL', 'PIGEON', 'FLAMINGO', 'GOOSE', 'DUCK', 'SWAN', 'ROOSTER']},
    {id: 'bugs-reptiles', clues: ['CRAWLERS', 'REPTILE', 'INSECTS', 'VENOM', 'SCALES', 'BUGS'], words: ['ANT', 'BEE', 'BEETLE', 'BUTTERFLY', 'MOSQUITO', 'SPIDER', 'SCORPION', 'SNAKE', 'COBRA', 'LIZARD', 'FROG', 'TURTLE', 'DINOSAUR']},
    {id: 'food', clues: ['FOOD', 'MEAL', 'EDIBLE', 'CUISINE', 'SNACK', 'FLAVOR'], words: ['BREAD', 'CHEESE', 'BUTTER', 'MILK', 'COOKIE', 'CAKE', 'PIE', 'CANDY', 'CHOCOLATE', 'BURGER', 'PIZZA', 'PASTA', 'SOUP', 'SALAD', 'RICE', 'BEAN', 'CORN', 'POTATO', 'CARROT', 'ONION', 'GARLIC', 'TOMATO', 'PEPPER', 'OLIVE', 'SALT', 'SUGAR', 'HONEY', 'KETCHUP', 'MUSTARD', 'SAUCE', 'SPICE', 'FLAVOR']},
    {id: 'fruit', clues: ['FRUIT', 'JUICY', 'ORCHARD', 'TROPICAL', 'CITRUS', 'SWEET'], words: ['APPLE', 'APRICOT', 'BANANA', 'BERRY', 'CHERRY', 'FIG', 'GRAPE', 'KIWI', 'LEMON', 'LIME', 'MANGO', 'MELON', 'ORANGE', 'PEA', 'PEACH', 'PEAR', 'PINEAPPLE', 'PLUM', 'COCONUT', 'JUICE']},
    {id: 'kitchen', clues: ['KITCHEN', 'COOKING', 'DINING', 'UTENSIL', 'BAKERY', 'CHEF'], words: ['KITCHEN', 'OVEN', 'STOVE', 'FRIDGE', 'KETTLE', 'PAN', 'POT', 'BOWL', 'PLATE', 'CUP', 'FORK', 'SPOON', 'NAPKIN', 'BAKERY', 'BAKER', 'CHEF', 'RESTAURANT', 'CAFE', 'COFFEE', 'TEA']},
    {id: 'home', clues: ['HOME', 'HOUSEHOLD', 'FURNITURE', 'ROOMS', 'INDOOR', 'DOMESTIC'], words: ['HOME', 'HOUSE', 'ROOM', 'DOOR', 'WINDOW', 'ROOF', 'WALL', 'FLOOR', 'STAIRS', 'BASEMENT', 'ATTIC', 'CELLAR', 'GARAGE', 'CABIN', 'KITCHEN', 'BATH', 'CLOSET', 'CABINET', 'DRAWER', 'SHELF', 'TABLE', 'DESK', 'CHAIR', 'SOFA', 'COUCH', 'BED', 'PILLOW', 'BLANKET', 'CARPET', 'LAMP', 'LANTERN', 'MIRROR', 'CANDLE', 'VACUUM', 'WASHER', 'DRYER']},
    {id: 'clothing', clues: ['CLOTHING', 'FASHION', 'OUTFIT', 'WEARABLE', 'WARDROBE', 'DRESS'], words: ['SHOE', 'BOOT', 'SLIPPER', 'SOCK', 'GLOVE', 'HAT', 'CAP', 'HELMET', 'DRESS', 'SUIT', 'TUXEDO', 'JACKET', 'SCARF', 'BELT', 'COLLAR', 'APRON', 'TUTU', 'COSTUME', 'MASK', 'ARMOR', 'SHIELD']},
    {id: 'body', clues: ['BODY', 'ANATOMY', 'HUMAN', 'HEALTH', 'PHYSICAL', 'ORGAN'], words: ['BODY', 'HEAD', 'FACE', 'EYE', 'EAR', 'NOSE', 'MOUTH', 'TONGUE', 'TOOTH', 'BEARD', 'HAIR', 'SKIN', 'HAND', 'FINGER', 'THUMB', 'ARM', 'ELBOW', 'SHOULDER', 'BACK', 'LEG', 'KNEE', 'FOOT', 'HEART', 'BRAIN', 'BLOOD', 'BONE', 'ORGAN']},
    {id: 'medical', clues: ['MEDICAL', 'CLINICAL', 'HOSPITAL', 'DOCTOR', 'NURSING', 'PHARMACY'], words: ['DOCTOR', 'NURSE', 'HOSPITAL', 'CLINIC', 'PHARMACY', 'VIRUS', 'NEEDLE', 'BLOOD', 'HEART', 'BRAIN', 'ORGAN', 'HEALTH']},
    {id: 'colors', clues: ['COLOR', 'PALETTE', 'PAINT', 'SHADE', 'HUE', 'BRIGHT'], words: ['RED', 'BLUE', 'GREEN', 'YELLOW', 'BLACK', 'WHITE', 'GREY', 'BROWN', 'PURPLE', 'PINK', 'ORANGE', 'CYAN', 'AZURE', 'VIOLET', 'INDIGO', 'CRIMSON', 'SCARLET', 'AMBER', 'BRONZE', 'SILVER', 'GOLD', 'COPPER', 'JADE', 'EMERALD', 'OPAL', 'PEARL']},
    {id: 'gems-metals', clues: ['PRECIOUS', 'JEWELRY', 'METAL', 'GEMS', 'MINERAL', 'TREASURE'], words: ['GOLD', 'SILVER', 'BRONZE', 'COPPER', 'IRON', 'STEEL', 'METAL', 'COAL', 'STONE', 'ROCK', 'MARBLE', 'CRYSTAL', 'DIAMOND', 'RUBY', 'EMERALD', 'OPAL', 'JADE', 'PEARL', 'JEWEL', 'TREASURE', 'COIN']},
    {id: 'nature', clues: ['NATURE', 'OUTDOORS', 'WILD', 'EARTHY', 'SCENERY', 'LANDSCAPE'], words: ['FOREST', 'JUNGLE', 'GARDEN', 'PARK', 'FIELD', 'VALLEY', 'HILL', 'MOUNTAIN', 'CLIFF', 'CANYON', 'CAVE', 'DESERT', 'SAHARA', 'EVEREST', 'HIMALAYAS', 'VOLCANO', 'LAVA', 'MUD', 'SAND', 'GRAVEL', 'CLAY', 'DUST', 'ASH', 'OASIS', 'SWAMP', 'WATERFALL']},
    {id: 'plants', clues: ['PLANTS', 'BOTANY', 'GROWTH', 'FLORAL', 'GREENERY', 'GARDEN'], words: ['TREE', 'BRANCH', 'ROOT', 'LEAF', 'FLOWER', 'ROSE', 'TULIP', 'ORCHID', 'BLOSSOM', 'GRASS', 'BUSH', 'MOSS', 'VINE', 'CEDAR']},
    {id: 'weather', clues: ['WEATHER', 'SKY', 'CLIMATE', 'STORMY', 'FORECAST', 'AIR'], words: ['SUN', 'MOON', 'STAR', 'CLOUD', 'RAIN', 'SNOW', 'ICE', 'FROST', 'STORM', 'THUNDER', 'LIGHTNING', 'TORNADO', 'HURRICANE', 'WIND', 'SMOKE', 'FIRE', 'FLAME', 'GLOW', 'LIGHT', 'BEACON', 'MORNING', 'EVENING', 'NIGHT']},
    {id: 'space', clues: ['SPACE', 'COSMIC', 'ORBITAL', 'ASTRO', 'GALAXY', 'PLANETARY'], words: ['SPACE', 'GALAXY', 'ORBIT', 'PLANET', 'EARTH', 'MERCURY', 'VENUS', 'MARS', 'JUPITER', 'SATURN', 'NEPTUNE', 'PLUTO', 'MOON', 'STAR', 'COMET', 'METEOR', 'ASTEROID', 'ECLIPSE', 'ROCKET', 'SATELLITE']},
    {id: 'travel', clues: ['TRAVEL', 'TRANSIT', 'VEHICLE', 'TRANSPORT', 'JOURNEY', 'ROAD'], words: ['CAR', 'TAXI', 'BUS', 'TRUCK', 'TRAIN', 'SUBWAY', 'STATION', 'TRACK', 'ENGINE', 'TICKET', 'PLANE', 'JET', 'HELICOPTER', 'AIRPORT', 'PILOT', 'DRIVER', 'BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'FERRY', 'BOAT', 'SHIP', 'ROAD', 'TRAFFIC', 'PARKING', 'BRAKE', 'WHEEL', 'TIRE', 'COMPASS', 'MAP']},
    {id: 'places', clues: ['GEOGRAPHY', 'WORLD', 'COUNTRY', 'CITY', 'GLOBAL', 'TRAVEL'], words: ['COUNTRY', 'NATION', 'AMERICA', 'CANADA', 'BRAZIL', 'MEXICO', 'EUROPE', 'ASIA', 'AFRICA', 'INDIA', 'CHINA', 'EGYPT', 'GREECE', 'ROME', 'PARIS', 'LONDON', 'TOKYO', 'DUBAI', 'CAIRO', 'AMAZON', 'NILE', 'HIMALAYAS', 'EVEREST', 'SAHARA', 'CITY', 'VILLAGE', 'STREET', 'ROAD', 'BRIDGE', 'TUNNEL', 'MALL', 'MARKET', 'STORE', 'HOTEL', 'UNIVERSITY', 'COLLEGE', 'SCHOOL', 'LIBRARY', 'MUSEUM', 'THEATER', 'CINEMA', 'CHURCH', 'MOSQUE', 'TEMPLE', 'PRISON', 'FACTORY', 'OFFICE', 'LABORATORY', 'FARM', 'ZOO', 'AQUARIUM', 'STADIUM', 'ARENA', 'COURT']},
    {id: 'people', clues: ['PEOPLE', 'PERSON', 'ROLE', 'WORKER', 'HUMAN', 'CHARACTER'], words: ['FATHER', 'FARMER', 'BAKER', 'CHEF', 'DOCTOR', 'NURSE', 'TEACHER', 'STUDENT', 'ATHLETE', 'COACH', 'REFEREE', 'LAWYER', 'JUDGE', 'POLICE', 'SHERIFF', 'GUARD', 'SOLDIER', 'ARMY', 'CAPTAIN', 'GENERAL', 'PRESIDENT', 'MAYOR', 'PIRATE', 'SAILOR', 'COWBOY', 'VIKING', 'SAMURAI', 'NINJA', 'SPY', 'AGENT', 'ROBBER', 'DEALER', 'DRIVER', 'PILOT', 'MINER', 'HUNTER', 'ARTIST', 'WRITER', 'POET', 'ACTOR', 'DANCER', 'SINGER', 'HERO', 'VILLAIN', 'BRIDE', 'GROOM']},
    {id: 'history', clues: ['HISTORY', 'FAMOUS', 'LEGEND', 'CLASSIC', 'GENIUS', 'ANCIENT'], words: ['EDISON', 'EINSTEIN', 'TESLA', 'NEWTON', 'LINCOLN', 'COLUMBUS', 'SHAKESPEARE', 'MOZART', 'PICASSO', 'CAESAR', 'CLEOPATRA', 'NAPOLEON', 'SAMURAI', 'VIKING', 'EGYPT', 'ROME', 'GREECE']},
    {id: 'arts', clues: ['ARTS', 'STAGE', 'CREATIVE', 'PERFORM', 'CULTURE', 'SHOW'], words: ['MUSIC', 'SONG', 'BAND', 'ORCHESTRA', 'PIANO', 'GUITAR', 'VIOLIN', 'FLUTE', 'TRUMPET', 'DRUM', 'MICROPHONE', 'SPEAKER', 'RADIO', 'HEADPHONE', 'SOUND', 'NOISE', 'VOICE', 'BEAT', 'DANCE', 'DANCER', 'BALLET', 'THEATER', 'CINEMA', 'COMEDY', 'CIRCUS', 'PARADE', 'FESTIVAL', 'PARTY', 'ALBUM', 'CAMERA', 'PAINT', 'CRAYON', 'INK', 'STATUE', 'ARTIST', 'WRITER', 'POET', 'STORY', 'FABLE', 'JOKE', 'RIDDLE']},
    {id: 'sports-games', clues: ['SPORTS', 'GAME', 'PLAY', 'COMPETITION', 'SCORE', 'MATCH'], words: ['SPORT', 'ATHLETE', 'TEAM', 'GOAL', 'SCORE', 'MATCH', 'BALL', 'SOCCER', 'TENNIS', 'GOLF', 'HOCKEY', 'BOWLING', 'BOXING', 'RACING', 'MARATHON', 'SWIMMING', 'SURFING', 'SKIING', 'SKATE', 'RACKET', 'COURT', 'ARENA', 'STADIUM', 'REFEREE', 'COACH', 'TROPHY', 'MEDAL', 'CHESS', 'CHECKER', 'DICE', 'CARD', 'ACE', 'CASINO', 'ARCADE', 'CONTROLLER', 'PUZZLE', 'TOY', 'DOLL', 'BALLOON']},
    {id: 'technology', clues: ['TECH', 'DIGITAL', 'ELECTRONIC', 'COMPUTING', 'DEVICE', 'CIRCUIT'], words: ['COMPUTER', 'LAPTOP', 'KEYBOARD', 'SCREEN', 'PHONE', 'SERVER', 'PROGRAM', 'CODE', 'PIXEL', 'ROBOT', 'PRINTER', 'CIRCUIT', 'CHIP', 'BATTERY', 'CABLE', 'WIRE', 'SWITCH', 'FILTER', 'SIGNAL', 'LASER', 'CAMERA', 'RADIO', 'SPEAKER', 'HEADPHONE']},
    {id: 'tools', clues: ['TOOLS', 'HARDWARE', 'WORKSHOP', 'BUILD', 'REPAIR', 'EQUIPMENT'], words: ['HAMMER', 'ANVIL', 'CHISEL', 'AXE', 'KNIFE', 'DAGGER', 'SWORD', 'SPEAR', 'CANNON', 'GUN', 'ARROW', 'BOW', 'ROPE', 'CHAIN', 'LADDER', 'BUCKET', 'TAPE', 'GLUE', 'NEEDLE', 'THREAD', 'BUTTON', 'ZIPPER', 'SCISSORS']},
    {id: 'law-danger', clues: ['DANGER', 'RISKY', 'CRIME', 'LEGAL', 'SECURITY', 'WARNING'], words: ['DANGER', 'RISK', 'CHAOS', 'SECRET', 'TRUTH', 'LIE', 'LAW', 'RULE', 'ORDER', 'LAWYER', 'JUDGE', 'POLICE', 'SHERIFF', 'GUARD', 'PRISON', 'ROBBER', 'SPY', 'AGENT', 'ARMY', 'SOLDIER', 'BADGE', 'SHIELD', 'SAFE', 'VAULT', 'COFFIN']},
    {id: 'money', clues: ['MONEY', 'FINANCE', 'PAYMENT', 'BANKING', 'VALUE', 'PRICE'], words: ['MONEY', 'CASH', 'COIN', 'DOLLAR', 'EURO', 'POUND', 'SHEKEL', 'BANK', 'VAULT', 'WALLET', 'CARD', 'BILL', 'PRICE', 'TAX', 'TRADE', 'DEALER', 'MARKET', 'STORE', 'MALL', 'CHECK', 'ORDER']},
    {id: 'magic-horror', clues: ['MAGIC', 'MYSTIC', 'FANTASY', 'SUPERNATURAL', 'HORROR', 'MYTH'], words: ['MAGICIAN', 'WIZARD', 'WITCH', 'FAIRY', 'ANGEL', 'GHOST', 'SPIRIT', 'PHOENIX', 'DRAGON', 'UNICORN', 'GIANT', 'MONSTER', 'ZOMBIE', 'VAMPIRE', 'DEMON', 'CLOWN', 'VILLAIN', 'SHADOW', 'DARK', 'DREAM', 'LUCK']},
    {id: 'time', clues: ['TIME', 'CALENDAR', 'CLOCK', 'SEASON', 'DATE', 'DURATION'], words: ['TIME', 'CLOCK', 'WATCH', 'HOUR', 'MINUTE', 'SECOND', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'DATE', 'MORNING', 'EVENING', 'NIGHT', 'SPRING', 'SUMMER', 'AUTUMN', 'WINTER', 'HOLIDAY', 'BIRTHDAY', 'WEDDING']},
    {id: 'language', clues: ['LANGUAGE', 'WRITING', 'MESSAGE', 'IDEA', 'ANSWER', 'MEMORY'], words: ['WORD', 'LETTER', 'PAGE', 'PAPER', 'BOOK', 'NOTE', 'NAME', 'QUESTION', 'ANSWER', 'CLUE', 'SIGN', 'SYMBOL', 'MAIL', 'FOLDER', 'MEMORY', 'IDEA', 'STORY', 'FABLE', 'RIDDLE', 'JOKE', 'TRUTH', 'LIE', 'SECRET']},
    {id: 'school', clues: ['SCHOOL', 'EDUCATION', 'CLASSROOM', 'STUDY', 'LEARNING', 'ACADEMIC'], words: ['SCHOOL', 'UNIVERSITY', 'COLLEGE', 'TEACHER', 'STUDENT', 'BOOK', 'PENCIL', 'PEN', 'PAPER', 'PAGE', 'LETTER', 'NOTE', 'QUESTION', 'ANSWER', 'LIBRARY', 'LABORATORY']},
    {id: 'materials', clues: ['MATERIAL', 'TEXTILE', 'SUBSTANCE', 'SURFACE', 'FABRIC', 'SOLID'], words: ['WOOD', 'PLASTIC', 'RUBBER', 'GLASS', 'PAPER', 'COTTON', 'WOOL', 'SILK', 'VELVET', 'LEATHER', 'FABRIC', 'THREAD', 'METAL', 'IRON', 'STEEL', 'COPPER', 'STONE', 'ROCK', 'MARBLE', 'CLAY', 'BRICK', 'CARTON', 'BOX', 'BOTTLE', 'SOAP', 'SHAMPOO', 'SPONGE', 'TOWEL']},
    {id: 'objects', clues: ['OBJECT', 'ITEM', 'THING', 'GEAR', 'SUPPLY', 'EQUIPMENT'], words: ['BAG', 'BANNER', 'BARREL', 'BASKET', 'BEACON', 'BELL', 'BLOCK', 'BOTTLE', 'BOX', 'BROOM', 'CABINET', 'CANDLE', 'CARTON', 'CHEST', 'CIRCLE', 'CLUB', 'COMPASS', 'CRADLE', 'FILTER', 'FOLDER', 'GLASS', 'HORN', 'KEYBOARD', 'LAMP', 'LANTERN', 'MAIL', 'MAP', 'MIRROR', 'NET', 'PENCIL', 'PEN', 'PLATE', 'POCKET', 'RING', 'ROPE', 'SADDLE', 'SHELF', 'SIGN', 'SLIDER', 'SOAP', 'SPONGE', 'SWITCH', 'TAPE', 'TICKET', 'TOOTHBRUSH', 'TOWEL', 'TROPHY', 'UMBRELLA', 'WALLET', 'WHISTLE']},
    {id: 'shapes-positions', clues: ['SHAPE', 'POSITION', 'DIRECTION', 'CENTER', 'EDGE', 'FORM'], words: ['ROUND', 'CIRCLE', 'CENTER', 'CORNER', 'BACK', 'HEAD', 'FOOT', 'FIELD', 'TRACK', 'ROAD', 'BRIDGE', 'TUNNEL', 'STAIRS', 'WALL', 'FLOOR', 'ROOF']},
    {id: 'emotion-abstract', clues: ['ABSTRACT', 'FEELING', 'THOUGHT', 'MOOD', 'CONCEPT', 'MENTAL'], words: ['CHANCE', 'CHAOS', 'DREAM', 'IDEA', 'LUCK', 'MEMORY', 'ORDER', 'QUESTION', 'ANSWER', 'RISK', 'RULE', 'SECRET', 'SILENCE', 'SMILE', 'TRUTH', 'LIE', 'SOUND', 'TIME']}
];

const BOT_EXTRA_FALLBACK_CLUES = ['KNOWN', 'ASSOCIATED', 'RELATED', 'GENERAL', 'COMMON', 'REFERENCE'];

function normalizeWordList(words = []) {
    return [...new Set(words.map(w => String(w).toUpperCase()).filter(w => /^[A-Z][A-Z-]{1,20}$/.test(w)))];
}

function buildBotClueGroups() {
    const bank = new Set(WORDS);
    const covered = new Set();
    const groups = [];

    BOT_CLUE_CATEGORY_SPECS.forEach(spec => {
        const words = normalizeWordList(spec.words).filter(w => bank.has(w));
        if (!words.length) return;
        words.forEach(w => covered.add(w));
        normalizeWordList(spec.clues)
            .filter(clue => /^[A-Z]+$/.test(clue))
            .forEach(clue => {
                groups.push({clue, words, key: `semantic:${spec.id}`});
            });
    });

    const uncovered = WORDS.filter(w => !covered.has(w));
    if (uncovered.length) {
        BOT_EXTRA_FALLBACK_CLUES.forEach(clue => {
            groups.push({clue, words: uncovered, key: 'semantic:uncategorized'});
        });
    }

    return groups;
}

const BOT_CLUE_GROUPS = buildBotClueGroups();

function addSinglePlayerBots(room, humanCharacter = '') {
    const characterIds = CHARACTERS.map(c => c.id);
    const pickChar = (...avoid) => characterIds.find(id => !avoid.includes(id)) || 'oracle';
    room.players[SINGLE_BOT_IDS.blackBot] = {
        id: SINGLE_BOT_IDS.blackBot,
        socketId: '',
        name: 'DSTY Bot',
        avatar: '',
        discordId: '',
        team: 'red',
        role: 'operative',
        character: pickChar(humanCharacter),
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
        online: true,
        isBot: true
    };
}

function chooseBotClue(room, team) {
    const own = room.board.filter(c => !c.revealed && c.color === team);
    if (!own.length) return null;
    const boardWords = new Set(room.board.filter(c => !c.revealed).map(c => c.word));
    const usedClues = new Set((room.singlePlayerUsedClues?.[team] || []).map(w => String(w).toUpperCase()));
    const usedGroupKeys = new Set(room.singlePlayerUsedClueGroups?.[team] || []);
    const buildOptions = (allowUsedGroup = false) => BOT_CLUE_GROUPS
        .filter(group => {
            const clue = String(group.clue || '').toUpperCase();
            const key = clueGroupKey(group);
            return /^[A-Z]+$/.test(clue) &&
                !boardWords.has(clue) &&
                !usedClues.has(clue) &&
                (allowUsedGroup || !usedGroupKeys.has(key));
        })
        .map(group => {
            const groupWords = new Set((group.words || []).map(w => String(w).toUpperCase()));
            const matches = own.filter(c => groupWords.has(c.word));
            const hazardCards = room.board.filter(c => !c.revealed && c.color !== team && groupWords.has(c.word));
            const targetCards = matches.slice(0, 9);
            const multiBonus = targetCards.length >= 2 ? 30 : 0;
            const specificBonus = Math.max(0, 18 - Math.floor(groupWords.size / 8));
            const score = targetCards.length * 100 + multiBonus + specificBonus;
            return {group, groupKey: clueGroupKey(group), targetCards, hazardCards, score};
        })
        .filter(x => x.targetCards.length && x.hazardCards.length === 0);
    const options = buildOptions(false);
    const relaxedOptions = options.length ? options : buildOptions(true);
    const best = relaxedOptions.sort((a, b) =>
        b.targetCards.length - a.targetCards.length ||
        b.score - a.score ||
        a.group.words.length - b.group.words.length
    )[0];
    if (best && best.score >= 10) {
        return {
            word: best.group.clue,
            groupKey: best.groupKey,
            targets: best.targetCards,
            number: best.targetCards.length
        };
    }
    const singleOptions = shuffle(own).map(card => {
        const group = BOT_CLUE_GROUPS.find(group => {
            const clue = String(group.clue || '').toUpperCase();
            const groupWords = new Set((group.words || []).map(w => String(w).toUpperCase()));
            const hazards = room.board.filter(c => !c.revealed && c.color !== team && groupWords.has(c.word));
            return /^[A-Z]+$/.test(clue) &&
                !boardWords.has(clue) &&
                !usedClues.has(clue) &&
                !usedGroupKeys.has(clueGroupKey(group)) &&
                groupWords.has(card.word) &&
                hazards.length === 0;
        });
        return {card, group};
    }).filter(x => x.group);
    if (singleOptions.length) {
        const picked = singleOptions[0];
        return {word: picked.group.clue, groupKey: clueGroupKey(picked.group), targets: [picked.card], number: 1};
    }
    const card = shuffle(own)[0];
    const fallback = ['TARGET', 'SOLO', 'SINGLE', 'DIRECT', 'FOCUS'].find(w => !boardWords.has(w) && !usedClues.has(w)) || 'TARGET';
    return {word: fallback, groupKey: `fallback:${fallback}`, targets: [card], number: 1};
}

function applyConfirmedGuess(room, p, card) {
    card.revealed = true;
    card.revealedBy = p.name;
    card.revealedById = p.id;
    const team = p.team;
    room.guessesThisTurn += 1;
    removeVoteForCard(room, card.id);
    room.log.push(`PICK|${team}|${card.color}|${card.word}|${p.name}|${p.avatar || ''}|${p.character || ''}`);

    if (card.color === 'assassin') {
        finish(room, team === 'blue' ? 'red' : 'blue', `${p.name} confirmed the grey danger card.`);
        return;
    }

    const leftAfterReveal = counts(room);
    if (leftAfterReveal.blue === 0) {
        finish(room, 'blue', 'GOLD reached 0 remaining cards.');
        return;
    }
    if (leftAfterReveal.red === 0) {
        finish(room, 'red', 'BLACK reached 0 remaining cards.');
        return;
    }

    if (card.color === 'neutral' || card.color !== team) {
        switchTurn(room);
        return;
    }

    const maxGuesses = room.allowedGuesses || ((room.clue?.number || 0) + 1);
    const remainingBonus = Math.max(0, maxGuesses - room.guessesThisTurn);
    if (remainingBonus <= 0) switchTurn(room);
}

function botGiveClue(room) {
    if (!room?.singlePlayer || room.status !== 'waiting-clue' || room.winner) return;
    const clue = chooseBotClue(room, room.turn);
    if (!clue) return;
    room.board.forEach(c => c.clueTarget = false);
    clue.targets.forEach(card => card.clueTarget = true);
    const giver = room.turn === 'blue'
        ? {name: 'DSTY Oracle', character: 'oracle'}
        : {name: 'Bot Oracle', character: 'ninja'};
    room.clue = {
        word: safeText(clue.word, 24).replace(/\s+/g, '-'),
        number: clue.number,
        by: giver?.name || 'DSTY Oracle',
        avatar: '',
        team: room.turn,
        targetIds: clue.targets.map(c => c.id),
        extraHint: false,
        at: Date.now()
    };
    room.singlePlayerUsedClues = room.singlePlayerUsedClues || {blue: [], red: []};
    room.singlePlayerUsedClues[room.turn] = room.singlePlayerUsedClues[room.turn] || [];
    if (!room.singlePlayerUsedClues[room.turn].includes(room.clue.word.toUpperCase())) {
        room.singlePlayerUsedClues[room.turn].push(room.clue.word.toUpperCase());
    }
    room.singlePlayerUsedClueGroups = room.singlePlayerUsedClueGroups || {blue: [], red: []};
    room.singlePlayerUsedClueGroups[room.turn] = room.singlePlayerUsedClueGroups[room.turn] || [];
    if (clue.groupKey && !room.singlePlayerUsedClueGroups[room.turn].includes(clue.groupKey)) {
        room.singlePlayerUsedClueGroups[room.turn].push(clue.groupKey);
    }
    room.guessesThisTurn = 0;
    room.allowedGuesses = clue.number + 1;
    room.status = 'guessing';
    room.votes = {};
    room.roundStartedAt = Date.now();
    room.hintRequested = null;
    room.log.push(`HINT|${room.turn}|${room.clue.word.toUpperCase()}|${room.clue.number}|${room.clue.by}|${room.clue.avatar || ''}|${giver?.character || ''}`);
    emitRoom(room);
    scheduleSinglePlayerBot(room);
}

function chooseBotGuess(room) {
    const unrevealed = room.board.filter(c => !c.revealed);
    const clueTargets = new Set(Array.isArray(room.clue?.targetIds) ? room.clue.targetIds : []);
    const intended = unrevealed.filter(c => c.color === 'red' && clueTargets.has(c.id));
    const black = unrevealed.filter(c => c.color === 'red');
    const neutral = unrevealed.filter(c => c.color === 'neutral');
    const wrongTeam = unrevealed.filter(c => c.color === 'blue');
    const danger = unrevealed.filter(c => c.color === 'assassin');
    const difficulty = ['easy', 'medium', 'extreme'].includes(room.singlePlayerDifficulty) ? room.singlePlayerDifficulty : 'medium';

    if (difficulty === 'extreme') {
        if (intended.length) return shuffle(intended)[0];
        if (black.length) return shuffle(black)[0];
        return shuffle(unrevealed)[0];
    }

    const roll = Math.random();
    const profile = difficulty === 'easy'
        ? {intended: .30, own: .50, neutral: .80, wrong: .96}
        : {intended: .50, own: .68, neutral: .88, wrong: .98};

    if (roll < profile.intended && intended.length) return shuffle(intended)[0];
    if (roll < profile.own && black.length) return shuffle(black)[0];
    if (roll < profile.neutral && neutral.length) return shuffle(neutral)[0];
    if (roll < profile.wrong && wrongTeam.length) return shuffle(wrongTeam)[0];
    return shuffle(danger.length ? danger : unrevealed)[0];
}

function botGuess(room) {
    if (!room?.singlePlayer || room.status !== 'guessing' || room.turn !== 'red' || room.winner) return;
    const bot = room.players[SINGLE_BOT_IDS.blackBot];
    const card = chooseBotGuess(room);
    if (!bot || !card) return;
    room.votes = {};
    room.votes[bot.id] = [card.id];
    emitRoom(room);
    room.botTimer = setTimeout(() => {
        if (!room.singlePlayer || room.status !== 'guessing' || room.turn !== 'red' || room.winner || card.revealed) return;
        applyConfirmedGuess(room, bot, card);
        emitRoom(room);
        scheduleSinglePlayerBot(room);
    }, 850);
}

function scheduleSinglePlayerBot(room) {
    if (!room?.singlePlayer) return;
    if (room.botTimer) clearTimeout(room.botTimer);
    if (room.status === 'finished') return;
    if (room.status === 'waiting-clue') {
        room.botTimer = setTimeout(() => botGiveClue(room), 650);
    } else if (room.status === 'guessing' && room.turn === 'red') {
        room.botTimer = setTimeout(() => botGuess(room), 1000 + Math.floor(Math.random() * 600));
    }
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

    socket.on('createSinglePlayerRoom', ({
                                             name,
                                             avatar = '',
                                             character = 'raiden',
                                             difficulty = 'medium',
                                             playerKey
                                         } = {}, cb = () => {
    }) => {
        const roomId = code();
        const room = newRoom(roomId);
        room.singlePlayer = true;
        room.singlePlayerDifficulty = ['easy', 'medium', 'extreme'].includes(difficulty) ? difficulty : 'medium';
        room.singlePlayerUsedClues = {blue: [], red: []};
        room.singlePlayerUsedClueGroups = {blue: [], red: []};
        room.turn = 'blue';
        room.board = makeBoard('blue', 'full');
        room.status = 'waiting-clue';
        room.roundStartedAt = Date.now();
        room.gameStartedAt = Date.now();
        room.log = [];
        rooms.set(roomId, room);
        const joined = joinRoom(socket, room, {
            name,
            avatar,
            discordId: '',
            team: 'blue',
            role: 'operative',
            character,
            playerKey,
            forceAdmin: true,
            adminToken: room.adminToken
        });
        if (joined?.ok === false) return cb(joined);
        const human = room.players[socket.data.playerKey];
        addSinglePlayerBots(room, human?.character || character);
        room.log.push(`Single Player started: GOLD vs DSTY Bot (${room.singlePlayerDifficulty.toUpperCase()} mode).`);
        emitRoom(room);
        scheduleSinglePlayerBot(room);
        cb({ok: true, roomId, playerKey: socket.data.playerKey, adminToken: room.adminToken, singlePlayer: true, difficulty: room.singlePlayerDifficulty});
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

        // If a disconnected user rejoins with a fresh browser/session key, remove
        // their old offline seat so the room does not show a duplicate no-wifi card.
        for (const [pid, oldPlayer] of Object.entries(room.players || {})) {
            if (pid === key || oldPlayer.online !== false) continue;
            const sameDiscordUser = !!(discordId && oldPlayer.discordId && oldPlayer.discordId === discordId);
            const sameNamedSeat = !!(incomingNameKey && nameKey(oldPlayer.name) === incomingNameKey);
            if (!sameDiscordUser && !sameNamedSeat) continue;
            if (oldPlayer.isAdmin && !forceAdmin) adminToken = room.adminToken;
            delete room.players[pid];
            delete room.votes?.[pid];
        }
        existing = room.players[key];

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
        scheduleSinglePlayerBot(room);
    });

    socket.on('newGame', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        if (room.botTimer) clearTimeout(room.botTimer);
        const players = room.players;
        const adminToken = room.adminToken;
        const fresh = newRoom(room.id);
        fresh.status = 'waiting-clue';
        fresh.log = [];
        fresh.players = players;
        fresh.adminToken = adminToken;
        fresh.singlePlayer = !!room.singlePlayer;
        fresh.singlePlayerDifficulty = room.singlePlayerDifficulty || 'medium';
        if (fresh.singlePlayer) {
            fresh.turn = 'blue';
            fresh.board = makeBoard('blue', 'full');
            fresh.singlePlayerUsedClues = {blue: [], red: []};
            fresh.singlePlayerUsedClueGroups = {blue: [], red: []};
        }
        rooms.set(room.id, fresh);
        emitRoom(fresh);
        scheduleSinglePlayerBot(fresh);
    });

    socket.on('resetTable', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!canAdmin(room, socket.id) && p?.role !== 'spymaster') return socket.emit('toast', 'Only the admin and spymasters can reset the table.');
        if (runAdminTableAction(room, 'resetTable', p?.name || 'Admin')) {
            emitRoom(room);
            scheduleSinglePlayerBot(room);
        }
    });

    socket.on('changeWordList', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (!canAdmin(room, socket.id) && p?.role !== 'spymaster') return socket.emit('toast', 'Only the admin and spymasters can change the word list.');
        if (runAdminTableAction(room, 'changeWordList', p?.name || 'Admin')) {
            emitRoom(room);
            scheduleSinglePlayerBot(room);
        }
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

    socket.on('adminUpdatePlayer', ({playerId, action, team, role, name} = {}) => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const actor = getPlayerBySocket(room, socket.id);
        const canManagePlayers = !!(actor && (actor.isAdmin || actor.role === 'spymaster'));
        if (!canManagePlayers) return;
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
        if (action === 'changeName') {
            const oldName = target.name;
            const nextName = cleanName(name || target.name);
            target.name = nextName;
            target.lastSeenAt = Date.now();
            if (target.socketId) io.to(target.socketId).emit('toast', `Your name was changed to ${nextName}.`);
            socket.emit('toast', `${oldName} is now ${nextName}.`);
            room.log.push(`${actor?.name || 'Admin'} changed ${oldName}'s name to ${nextName}.`);
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
        const declaredNumber = Math.max(0, Math.min(9, parseInt(number, 10) || 0));
        number = declaredNumber;
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

        applyConfirmedGuess(room, p, card);
        emitRoom(room);
        scheduleSinglePlayerBot(room);
    });

    socket.on('endTurn', () => {
        const room = getPlayerRoom(socket.id);
        if (!room) return;
        const p = getPlayerBySocket(room, socket.id);
        if (playerCanAct(room, p) && room.status === 'guessing') {
            room.log.push(`PASS|${p.team}|${p.name}|${p.avatar || ''}|${p.character || ''}`);
            switchTurn(room);
            emitRoom(room);
            scheduleSinglePlayerBot(room);
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
            const offlinePlayerId = p.id;
            p.online = false;
            p.socketId = null;
            p.lastSeenAt = Date.now();
            room.log.push(`${p.name} disconnected. The room stays alive and they can rejoin with code ${room.id}.`);
            emitRoom(room);
            setTimeout(() => {
                const latest = room.players?.[offlinePlayerId];
                if (!latest || latest.online !== false) return;
                delete room.votes?.[offlinePlayerId];
                delete room.players[offlinePlayerId];
                emitRoom(room);
            }, 10000);
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
