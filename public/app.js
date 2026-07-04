const socket = io();
let state = null, selectedCharacter = 'raiden', targetIds = new Set(), lastRevealed = new Set();
let lastWinKey = null, winDockTimer = null;
let lastBoardKey = '', lastBoardSpawnAt = 0;

function makePlayerKey() {
    return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readTabPlayerKey() {
    try {
        let key = sessionStorage.getItem('cc_tabPlayerKey') || '';
        if (!key) {
            key = makePlayerKey();
            sessionStorage.setItem('cc_tabPlayerKey', key);
        }
        return key;
    } catch {
        return makePlayerKey();
    }
}

function setPlayerKey(newKey) {
    const key = String(newKey || '').trim() || makePlayerKey();
    playerKey = key;
    myId = key;
    try {
        sessionStorage.setItem('cc_tabPlayerKey', key);
    } catch {
    }
}

let playerKey = readTabPlayerKey();
let myId = playerKey;
let clueNumberEdited = false;
let lastClueTargetCount = 0;
const pendingRevealIds = new Set();

function adminStorageKey(roomId) {
    return `cc_adminToken_${String(roomId || '').toUpperCase()}`;
}

function getAdminToken(roomId) {
    return localStorage.getItem(adminStorageKey(roomId)) || '';
}

function storeAdminToken(roomId, token) {
    if (roomId && token) localStorage.setItem(adminStorageKey(roomId), token);
}

const $ = id => document.getElementById(id);
const landing = $('landing'), game = $('game'), board = $('board');
const nameInput = $('name'), roomInput = $('roomCode');
const avatarFileInput = $('avatarFile'), avatarPreview = $('avatarPreview'), avatarUploadBtn = $('avatarUploadBtn'),
    avatarClearBtn = $('avatarClearBtn');
let customAvatar = localStorage.cc_avatar || '';
let nameWasEditedLocally = !!localStorage.cc_name;
if (nameInput) nameInput.value = localStorage.cc_name || '';

function lockDiscordNameField() {
    // Discord Activity no longer locks or auto-fills the player name.
    // Every player can type/edit their own in-game name.
    if (!nameInput) return;
    nameInput.readOnly = false;
    nameInput.classList.remove('discordNameLocked');
    nameInput.title = '';
}

function isRealDiscordName(value) {
    const n = String(value || '').trim();
    if (!n) return false;
    return !['discord user', 'loading discord name...', 'getting discord name...', 'waiting for discord name...', 'discord guest', 'your name'].includes(n.toLowerCase());
}

function cachedDiscordName() {
    return '';
}

function resolvedDiscordName() {
    return '';
}

function applyDiscordNameToInput() {
    // Intentionally disabled. We keep Discord Activity room/invite support,
    // but names are now manual again.
    lockDiscordNameField();
}

function waitForDiscordName() {
    // No waiting for Discord identity anymore.
    return Promise.resolve('');
}

if (nameInput && !isRealDiscordName(nameInput.value)) {
    nameInput.value = '';
    try {
        if (!isRealDiscordName(localStorage.cc_name)) localStorage.removeItem('cc_name');
    } catch {
    }
}

const params = new URLSearchParams(location.search);

function safeContains(value, text) {
    try {
        return String(value || '').toLowerCase().includes(String(text || '').toLowerCase());
    } catch {
        return false;
    }
}

function runningInsideIframe() {
    try {
        return window.self !== window.top;
    } catch {
        return true;
    }
}

function hasDiscordAncestor() {
    try {
        return Array.from(window.location.ancestorOrigins || []).some(origin =>
            safeContains(origin, 'discord.com') ||
            safeContains(origin, 'discordapp.com') ||
            safeContains(origin, 'discordsays.com')
        );
    } catch {
        return false;
    }
}

function hasDiscordQuerySignal() {
    const discordKeys = [
        'discord',
        'instance_id',
        'instanceId',
        'activity_instance_id',
        'activityInstanceId',
        'frame_id',
        'frameId',
        'guild_id',
        'guildId',
        'channel_id',
        'channelId',
        'platform',
        'mobile',
        'referrer_id'
    ];

    return discordKeys.some(key => params.has(key));
}

const isInsideIframe = runningInsideIframe();
const isDiscordPath = location.pathname.toLowerCase().startsWith('/discord');

const isDiscordForced =
    window.FORCE_DISCORD_ACTIVITY === true ||
    isDiscordPath ||
    params.get('discord') === '1' ||
    params.get('discord') === 'true' ||
    hasDiscordQuerySignal() ||
    safeContains(location.hostname, 'discordsays.com') ||
    safeContains(location.hostname, 'discord.com') ||
    safeContains(document.referrer, 'discord') ||
    safeContains(navigator.userAgent, 'discord') ||
    hasDiscordAncestor() ||
    isInsideIframe;

if (isDiscordForced) {
    document.body.classList.add('discordActivity');
}

function roomCodeFromSeed(seed) {
    const s = String(seed || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0).toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
}

const localDiscordSeed = params.get('instance_id') || params.get('instanceId') || params.get('activity_instance_id') || params.get('activityInstanceId');
let discordActivityInfo = null;
let isDiscordActivity = isDiscordForced || Boolean(localDiscordSeed || safeContains(location.hostname, 'discordsays.com'));
let discordActivityRoomCode = localDiscordSeed ? roomCodeFromSeed(localDiscordSeed) : '';
if (isDiscordActivity) document.body.classList.add('discordActivity');
if (isDiscordActivity) setTimeout(() => applyDiscordNameToInput(true), 0);
window.DD_MODE_DIAGNOSTIC = {
    isDiscordActivity,
    isDiscordForced,
    isInsideIframe,
    path: location.pathname,
    host: location.hostname,
    referrer: document.referrer,
    userAgent: navigator.userAgent
};
console.log('DD mode diagnostic', window.DD_MODE_DIAGNOSTIC);
const inviteRoom = (params.get('room') || params.get('r') || '').trim().toUpperCase();
if (inviteRoom) roomInput.value = inviteRoom;
else if (discordActivityRoomCode) roomInput.value = discordActivityRoomCode;
let selectedTeamChoice = '';
let selectedRoleChoice = '';
let pendingAdminRequest = null;
let lastLobbyInfo = null;
const FALLBACK_CHARACTERS = [
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

function inviteUrl(roomId) {
    return `${location.origin}${location.pathname}?room=${String(roomId || '').toUpperCase()}`;
}

function updateInviteFields(roomId) {
    const code = String(roomId || roomInput.value || '').trim().toUpperCase();
    const link = code ? inviteUrl(code) : '';
    const l1 = $('inviteLinkLanding'), l2 = $('inviteLinkGame'), l3 = $('topInviteLink');
    if (l1) l1.value = link;
    if (l2) l2.value = link;
    if (l3) l3.value = link;
}

function requestLobbyInfo() {
    const code = roomInput.value.trim().toUpperCase();
    updateInviteFields(code);
    const box = $('lobbyPreview');
    if (!box) return;
    if (!code) {
        box.classList.add('hidden');
        box.innerHTML = '';
        lastLobbyInfo = null;
        renderCharacters();
        return;
    }
    socket.emit('getRoomInfo', {roomId: code}, res => {
        if (roomInput.value.trim().toUpperCase() !== code) return;
        if (!res || !res.ok) {
            lastLobbyInfo = null;
            renderCharacters();
            setJoinButtonsReady();
            if (selectedTeamChoice || selectedRoleChoice) {
                box.classList.remove('hidden');
                box.innerHTML = `<b>Room preview</b><span class="muted">Room not found yet. Create it or check the code.</span>`;
            } else {
                box.classList.add('hidden');
                box.innerHTML = '';
            }
            return;
        }
        lastLobbyInfo = res;
        renderCharacters();
        if (isDiscordActivity) paintDiscordLobby(res);
        setJoinButtonsReady();
        const gs = (res.spymasters?.blue || []).join(', ') || 'No Gold spymaster online';
        const bs = (res.spymasters?.red || []).join(', ') || 'No Black spymaster online';
        if (selectedTeamChoice || selectedRoleChoice || !isDiscordActivity) {
            box.classList.remove('hidden');
            box.innerHTML = `<b>Room ${res.roomId} preview</b><div class="previewGrid"><span>Gold: <strong>${res.counts.blue}</strong></span><span>Black: <strong>${res.counts.red}</strong></span><span>Spectators: <strong>${res.counts.spectator}</strong></span><span>Total: <strong>${res.playersTotal}</strong></span></div><div class="previewSpies"><span>Gold spymaster: <strong>${gs}</strong></span><span>Black spymaster: <strong>${bs}</strong></span></div>`;
        } else {
            box.classList.add('hidden');
            box.innerHTML = '';
        }
    });
}

roomInput.addEventListener('input', requestLobbyInfo);
setTimeout(requestLobbyInfo, 200);

const audio = new (window.AudioContext || window.webkitAudioContext)();

function tone(freq = 440, dur = .16, type = 'sine', gain = .05) {
    try {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.value = gain;
        o.connect(g);
        g.connect(audio.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + dur);
        o.stop(audio.currentTime + dur);
    } catch {
    }
}

function sound(kind) {
    if (audio.state === 'suspended') audio.resume();
    if (kind === 'win' || kind === 'correct') {
        tone(523, .09, 'sine', .035);
        setTimeout(() => tone(659, .10, 'sine', .035), 80);
        setTimeout(() => tone(784, .14, 'triangle', .04), 165);
        flash('winFlash');
    }
    if (kind === 'wrong') {
        tone(196, .12, 'triangle', .045);
        setTimeout(() => tone(155, .16, 'sawtooth', .04), 95);
        setTimeout(() => tone(116, .18, 'sawtooth', .035), 210);
        flash('loseFlash');
    }
    if (kind === 'neutral') {
        tone(392, .10, 'sine', .028);
        setTimeout(() => tone(330, .11, 'triangle', .026), 95);
        setTimeout(() => tone(294, .13, 'sine', .024), 190);
        flash('neutralFlash');
    }
    if (kind === 'gameWin') {
        [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, .16, 'triangle', .045), i * 95));
        setTimeout(() => tone(1568, .24, 'sine', .035), 520);
        flash('winFlash');
    }
    if (kind === 'lose') {
        tone(220, .14, 'sawtooth');
        setTimeout(() => tone(130, .2, 'sawtooth'), 120);
        flash('loseFlash');
    }
    if (kind === 'assassin') {
        tone(80, .45, 'square', .07);
        flash('loseFlash');
    }
    if (kind === 'clue') {
        tone(880, .08, 'sine');
        setTimeout(() => tone(1174, .08, 'sine'), 80);
    }
}

function flash(cls) {
    const d = document.createElement('div');
    d.className = cls;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 850);
}

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
}

function showAdminRequestPopup(req) {
    pendingAdminRequest = req;
    const modal = $('adminRequestModal');
    const text = $('adminRequestText');
    if (text) text.textContent = `${req.fromName || 'A player'} requests: ${req.label || 'Admin action'}. Apply it now?`;
    if (modal) modal.classList.remove('hidden');
}

function closeAdminRequestPopup() {
    pendingAdminRequest = null;
    const modal = $('adminRequestModal');
    if (modal) modal.classList.add('hidden');
}

function fmt(ms) {
    let s = Math.floor(ms / 1000);
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    s = String(s % 60).padStart(2, '0');
    return `${m}:${s}`;
}

function allCharacters() {
    return (state?.characters && state.characters.length ? state.characters : FALLBACK_CHARACTERS);
}

function charById(id) {
    return allCharacters().find(x => x.id === id) || allCharacters()[0] || {
        id: 'agent',
        name: 'Agent',
        emoji: '🕵️',
        accent: '#71e2ff'
    };
}

function charEmoji(id) {
    return charById(id).emoji || '🕵️';
}

function charAccent(id) {
    return charById(id).accent || '#71e2ff';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
}

function safeAvatarSrc(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v) || /^https:\/\//i.test(v)) return escapeHtml(v);
    return '';
}

function currentDisplayName() {
    const typed = (nameInput?.value || '').trim();
    return typed || localStorage.cc_name || 'Agent';
}

function me() {
    return state?.players?.[myId];
}

function teamName(team) {
    return team === 'blue' ? 'Gold' : team === 'red' ? 'Black' : team === 'neutral' ? 'Empty' : team === 'assassin' ? 'Danger' : 'Spectator';
}

function teamUpper(team) {
    return teamName(team).toUpperCase();
}

function hasOnlineSpymaster(team) {
    return Object.values(state?.players || {}).some(p => p.online !== false && p.team === team && p.role === 'spymaster');
}

function spymasterName(team) {
    const p = Object.values(state?.players || {}).find(p => p.online !== false && p.team === team && p.role === 'spymaster');
    return p?.name || null;
}

function spymasterForTeam(team) {
    return Object.values(state?.players || {}).find(p => p.online !== false && p.team === team && p.role === 'spymaster') || null;
}

function turnStatusHtml() {
    if (!state || state.status === 'finished') return '';
    if (state.status === 'waiting-clue') {
        if (state.singlePlayer) {
            return state.turn === 'blue' ? 'PREPARING YOUR CLUE' : 'PREPARING BOT CLUE';
        }
        const spy = spymasterForTeam(state.turn);
        if (!spy) return `WAITING FOR ${teamUpper(state.turn)} SPYMASTER TO GIVE A CLUE`;
        const src = safeAvatarSrc(playerAvatar(spy));
        const face = src
            ? `<span class="turnStatusAvatar"><img src="${src}" alt="${escapeHtml(spy.name || 'spymaster')}"></span>`
            : `<span class="turnStatusAvatar fallback">${charEmoji(spy.character)}</span>`;
        return `WAITING FOR ${face}<strong>${escapeHtml(spy.name || 'SPYMASTER')}</strong> TO GIVE A CLUE`;
    }
    if (state.status === 'guessing') {
        if (state.singlePlayer) {
            return state.turn === 'blue' ? 'YOUR TURN TO PICK THE CARDS' : 'DSTY BOT IS PICKING CARDS';
        }
        return `WAITING FOR ${teamUpper(state.turn)} TEAM OPERATIVES TO PICK THE CARDS`;
    }
    return '';
}


function discordUser() {
    const direct = window.DD_CURRENT_USER || window.DD_DISCORD?.currentUser || null;
    if (direct && (direct.id || isRealDiscordName(direct.name) || direct.avatar)) return direct;

    const participants = Array.isArray(window.DD_PARTICIPANTS) ? window.DD_PARTICIPANTS : (Array.isArray(window.DD_DISCORD?.participants) ? window.DD_DISCORD.participants : []);
    const lastId = localStorage.dd_last_discord_id || '';
    const picked = participants.find(p => p?.isCurrentUser) || (lastId ? participants.find(p => p?.id === lastId) : null) || (participants.length === 1 ? participants[0] : null);
    if (picked && (picked.id || isRealDiscordName(picked.name) || picked.avatar)) return picked;

    const cachedName = cachedDiscordName();
    const cachedId = localStorage.dd_last_discord_id || '';
    if (cachedName || cachedId) return {id: cachedId, name: cachedName, avatar: ''};
    return null;
}

function playerAvatar(p) {
    return p?.avatar || p?.avatarUrl || p?.avatar_url || '';
}

function discordProfileReady() {
    const u = discordUser();
    return !!(u && (u.id || (u.name && u.name !== 'Discord User') || u.avatar));
}

function playerNameFromDiscord() {
    return '';
}

function stableDiscordFallbackKey(roomCode = '') {
    const base = (() => {
        try {
            let seed = sessionStorage.getItem('cc_activityTabSeatSeed') || '';
            if (!seed) {
                seed = makePlayerKey();
                sessionStorage.setItem('cc_activityTabSeatSeed', seed);
            }
            return seed;
        } catch {
            return playerKey || makePlayerKey();
        }
    })();
    const safe = String(base).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'local';
    const room = String(roomCode || getDiscordActivityRoomCode?.() || 'room').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'room';
    return `d_local_${room}_${safe}`;
}

function ensureDiscordIdentity() {
    // Keep the Activity/session support, but do not fetch or force Discord names.
    lockDiscordNameField();
}

function renderDiscordIdentity() {
    const card = document.getElementById('discordIdentityCard');
    if (card) card.remove();
}

function updateHomeAvatarPreview() {
    if (!avatarPreview) return;
    const src = safeAvatarSrc(customAvatar);
    avatarPreview.classList.toggle('hasImage', !!src);
    document.body.classList.toggle('hasCustomAvatar', !!src);
    avatarPreview.innerHTML = src
        ? `<img src="${src}" alt="Your avatar preview">`
        : `<span style="--a:${charAccent(selectedCharacter)}">${charEmoji(selectedCharacter)}</span>`;
    if (avatarClearBtn) avatarClearBtn.classList.toggle('hidden', !src);
}

function setCustomAvatar(value) {
    customAvatar = value || '';
    if (customAvatar) localStorage.cc_avatar = customAvatar;
    else localStorage.removeItem('cc_avatar');
    updateHomeAvatarPreview();
    renderCharacters();
    setJoinButtonsReady();
    updateJoinSummary();
    scheduleProfileSync();
}

function hasCustomAvatar() {
    return !!safeAvatarSrc(customAvatar);
}

function outboundCharacter() {
    // Uploaded images are their own avatar choice, so they must not reserve any character slot.
    return hasCustomAvatar() ? '' : selectedCharacter;
}

function resizeAvatarFile(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) return reject(new Error('Choose an image file.'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the image.'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Could not load the image.'));
            img.onload = () => {
                const size = 180;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const minSide = Math.min(img.width, img.height) || 1;
                const sx = Math.max(0, (img.width - minSide) / 2);
                const sy = Math.max(0, (img.height - minSide) / 2);
                ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
                resolve(canvas.toDataURL('image/webp', .82));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

let profileSyncTimer = null;

function scheduleProfileSync() {
    if (profileSyncTimer) clearTimeout(profileSyncTimer);
    profileSyncTimer = setTimeout(sendProfileToServer, 250);
}

function sendProfileToServer() {
    profileSyncTimer = null;
    const current = me();
    if (!current || !state) return;
    socket.emit('updatePlayerProfile', {
        name: currentDisplayName(),
        avatar: customAvatar,
        character: outboundCharacter()
    }, res => {
        if (res?.ok === false) {
            toast(res.error || 'Could not update your profile.');
            if (res.character) selectedCharacter = res.character;
            renderCharacters();
            updateHomeAvatarPreview();
        }
    });
}

function setupProfileControls() {
    updateHomeAvatarPreview();
    if (avatarUploadBtn && avatarFileInput) avatarUploadBtn.onclick = () => avatarFileInput.click();
    if (avatarFileInput) avatarFileInput.onchange = async () => {
        const file = avatarFileInput.files && avatarFileInput.files[0];
        if (!file) return;
        try {
            const dataUrl = await resizeAvatarFile(file);
            setCustomAvatar(dataUrl);
            toast('Avatar updated.');
        } catch (err) {
            toast(err?.message || 'Could not upload avatar.');
        } finally {
            avatarFileInput.value = '';
        }
    };
    if (avatarClearBtn) avatarClearBtn.onclick = () => {
        setCustomAvatar('');
        toast('Avatar removed.');
    };
}

function avatarHtml(p, extra = '') {
    const crown = p?.role === 'spymaster' ? '<span class="crownMark">👑</span>' : '';
    const character = p?.character || selectedCharacter || 'raiden';
    const src = safeAvatarSrc(playerAvatar(p));
    const face = src ? `<img src="${src}" alt="${escapeHtml(p?.name || 'avatar')}" loading="lazy">` : charEmoji(character);
    return `<div class="avatar characterAvatar ${extra} ${src ? 'customAvatar' : ''}" style="--a:${charAccent(character)}">${face}${crown}</div>`;
}

function usedCharacters() {
    const used = new Set();
    const myDiscordId = discordUser()?.id || '';
    const addPlayer = p => {
        if (!p?.character) return;
        // A custom uploaded picture is not a game character, so it must not block/grey out a character.
        if (playerAvatar(p)) return;
        if (p.id && p.id === myId) return;
        if (myDiscordId && p.discordId && p.discordId === myDiscordId) return;
        if (p.online === false) return;
        used.add(p.character);
    };
    Object.values(state?.players || {}).forEach(addPlayer);
    const roles = lastLobbyInfo?.roles || {};
    for (const team of Object.values(roles)) {
        for (const list of Object.values(team || {})) {
            (Array.isArray(list) ? list : []).forEach(addPlayer);
        }
    }
    return used;
}

function renderCharacters() {
    const box = $('characterPick');
    if (!box) return;
    box.classList.remove('hidden');
    const list = allCharacters();
    const taken = usedCharacters();
    const usingCustom = hasCustomAvatar();
    if (!usingCustom && taken.has(selectedCharacter)) {
        const free = list.find(c => !taken.has(c.id));
        if (free) selectedCharacter = free.id;
    }
    box.innerHTML = `
    <div class="characterTitle">Choose your character</div>
    <div class="characterGrid">${list.map(c => {
        const disabled = !usingCustom && taken.has(c.id);
        const selected = !usingCustom && c.id === selectedCharacter;
        return `<button type="button" class="char ${selected ? 'selected' : ''} ${disabled ? 'taken' : ''}" data-char="${c.id}" title="${disabled ? c.name + ' is already taken' : c.name}" style="--a:${c.accent}" ${disabled ? 'disabled' : ''}><span>${c.emoji}</span><small>${c.name}</small></button>`;
    }).join('')}</div>`;
    box.querySelectorAll('.char').forEach(el => {
        el.onclick = () => {
            if (el.disabled || el.classList.contains('taken')) {
                toast('That character is already taken. Pick another one.');
                return;
            }
            selectedCharacter = el.dataset.char;
            renderCharacters();
            updateHomeAvatarPreview();
            setJoinButtonsReady();
            updateJoinSummary();
            renderDiscordIdentity();
            const currentPlayer = me();
            if (currentPlayer && state) {
                socket.emit('updatePlayerProfile', {
                    name: currentDisplayName(),
                    avatar: customAvatar,
                    character: outboundCharacter()
                }, res => {
                    if (res?.ok === false) {
                        toast(res.error || 'That character is already taken.');
                        selectedCharacter = currentPlayer.character || selectedCharacter;
                        renderCharacters();
                        updateHomeAvatarPreview();
                    }
                });
            } else if (isDiscordActivity && state?.status === 'lobby' && currentPlayer) {
                socket.emit('joinOrCreateActivityRoom', discordJoinPayload(currentPlayer.team, currentPlayer.role), acceptJoinResponse);
            }
        };
    });
}

renderCharacters();

function sameLocalPlayer(p) {
    const du = discordUser?.() || null;
    return !!(p && (p.id === myId || (du?.id && p.discordId === du.id)));
}

function lobbyRolePlayers(team, role) {
    const merged = [];
    const seen = new Set();
    const add = p => {
        if (!p) return;
        const key = p.discordId || p.id || p.socketId || `${p.name || 'player'}_${merged.length}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(p);
    };
    const fromLobby = lastLobbyInfo?.roles?.[team]?.[role];
    if (Array.isArray(fromLobby)) fromLobby.forEach(add);
    if (state?.players) Object.values(state.players).filter(p =>
        p &&
        p.online !== false &&
        p.team === team &&
        p.role === role
    ).forEach(add);
    return merged;
}

function spymasterSlotFullFor(team) {
    return lobbyRolePlayers(team, 'spymaster').some(p => !sameLocalPlayer(p));
}

function selectedSpymasterSlotFull() {
    return !!(selectedRoleChoice === 'spymaster' && selectedTeamChoice !== 'spectator' && spymasterSlotFullFor(selectedTeamChoice));
}

function refreshRoleFullStates(team = selectedTeamChoice) {
    document.querySelectorAll('.rolePick').forEach(btn => {
        const role = btn.dataset.role;
        const label = btn.querySelector('b');
        if (label && !btn.dataset.baseLabel) btn.dataset.baseLabel = label.textContent || '';
        const fullSpy = role === 'spymaster' && team !== 'spectator' && spymasterSlotFullFor(team);
        btn.disabled = !!fullSpy;
        btn.classList.toggle('fullRole', !!fullSpy);
        btn.setAttribute('aria-disabled', fullSpy ? 'true' : 'false');
        if (label) label.textContent = fullSpy ? 'Spymaster Full' : (btn.dataset.baseLabel || label.textContent || role);
    });
}

function setJoinButtonsReady() {
    const ready = !!(selectedTeamChoice && selectedRoleChoice && nameInput.value.trim());
    const cb = $('createBtn'), jb = $('joinBtn');
    const selectedSpyFull = selectedSpymasterSlotFull();
    refreshRoleFullStates();
    if (isDiscordActivity) {
        const characterReady = hasCustomAvatar() || (!!selectedCharacter && !usedCharacters().has(selectedCharacter));
        if (cb) cb.disabled = true;
        if (jb) jb.disabled = true;
        document.querySelectorAll('.discordRoleJoin').forEach(b => {
            const role = b.dataset.role;
            const team = b.dataset.team;
            const fullSpy = role === 'spymaster' && team !== 'spectator' && spymasterSlotFullFor(team);
            b.disabled = !characterReady || fullSpy;
            b.textContent = fullSpy ? 'Full' : (role === 'spectator' ? 'Join as Spectator' : 'Join');
        });
        return;
    }
    if (cb) cb.disabled = !ready;
    if (jb) {
        jb.disabled = !ready || selectedSpyFull || !roomInput.value.trim();
        jb.textContent = selectedSpyFull ? 'Spymaster Full' : 'Join Room';
    }
}

function updateJoinSummary() {
    // The selected team/role is shown by placing the local user preview inside
    // the matching lobby role box, instead of using the old separate summary bar.
    const box = $('joinSummary');
    if (box) {
        box.classList.add('hidden');
        box.textContent = '';
    }
    if (lastLobbyInfo?.ok && isDiscordActivity) paintDiscordLobby(lastLobbyInfo);
}

function openRolePopup(team) {
    const overlay = $('roleOverlay');
    if (!overlay) return;
    const title = $('rolePopupTitle');
    const text = $('rolePopupText');
    if (team === 'spectator') {
        if (title) title.textContent = 'Join as spectator';
        if (text) text.textContent = 'Spectators can watch the game without guessing or giving clues.';
        document.querySelectorAll('.rolePick').forEach(b => b.classList.toggle('hidden', b.dataset.role !== 'spectator'));
    } else {
        if (title) title.textContent = `Choose your ${teamName(team)} role`;
        if (text) text.textContent = 'Pick Operative to guess cards, or Spymaster to give clues.';
        document.querySelectorAll('.rolePick').forEach(b => b.classList.toggle('hidden', b.dataset.role === 'spectator'));
    }
    refreshRoleFullStates(team);
    overlay.classList.remove('hidden');
}

function closeRolePopup() {
    const o = $('roleOverlay');
    if (o) o.classList.add('hidden');
}

function syncDiscordLanding() {
    document.body.classList.toggle('discordActivity', !!isDiscordActivity);
    const dl = $('discordLobby');
    if (dl) dl.classList.toggle('hidden', !isDiscordActivity);
    const teamChoice = $('teamChoice');
    if (teamChoice) teamChoice.classList.toggle('hidden', !!isDiscordActivity);
    const actions = document.querySelector('.actions');
    if (actions) actions.classList.toggle('hidden', !!isDiscordActivity);
    const roleOverlay = $('roleOverlay');
    if (roleOverlay && isDiscordActivity) roleOverlay.classList.add('hidden');
    const roomField = document.querySelector('.websiteRoomField');
    if (roomField) roomField.classList.toggle('hidden', !!isDiscordActivity);
    const title = document.querySelector('.teamChooseTitle');
    if (title) title.textContent = isDiscordActivity ? 'Choose your role' : 'Choose your team';
    const chars = $('characterPick');
    if (chars) chars.classList.remove('hidden');
    if (isDiscordActivity) {
        ensureDiscordIdentity();
        applyDiscordNameToInput(true);
        renderDiscordIdentity();
    }
    refreshDiscordLobbyPreview();
    refreshLandingAdminControls();
    setJoinButtonsReady();
}

function getDiscordActivityRoomCode() {
    const seed = window.DD_DISCORD?.instanceId || localDiscordSeed || discordActivityRoomCode || 'local-discord-test';
    return roomCodeFromSeed(seed);
}

function discordJoinPayload(team, role) {
    const roomCode = getDiscordActivityRoomCode();
    const finalName = currentDisplayName();
    const finalAvatar = customAvatar || '';

    // Do not depend on Discord identity. A stable per-tab Activity key makes joins
    // work on PC, mobile, tablet, and iPad even when Discord profile data is delayed.
    setPlayerKey(stableDiscordFallbackKey(roomCode));
    myId = playerKey;
    localStorage.cc_name = finalName;
    nameInput.value = finalName;
    roomInput.value = roomCode;
    discordActivityRoomCode = roomCode;

    return {
        activityId: window.DD_DISCORD?.instanceId || localDiscordSeed || roomCode,
        roomId: roomCode,
        name: finalName,
        avatar: finalAvatar,
        discordId: '',
        team,
        role,
        character: outboundCharacter(),
        playerKey,
        adminToken: getAdminToken(roomCode)
    };
}

async function joinDiscordActivity(team, role) {
    if (!nameInput.value.trim()) {
        toast('Write your name first.');
        nameInput.focus();
        return;
    }
    selectedTeamChoice = team;
    selectedRoleChoice = role;
    const teamSel = $('team'), roleSel = $('role');
    if (teamSel) teamSel.value = team;
    if (roleSel) roleSel.value = role;
    updateJoinSummary();
    setJoinButtonsReady();
    if (role === 'spymaster' && spymasterSlotFullFor(team)) {
        toast(`${teamName(team)} Team already has a spymaster.`);
        return;
    }

    const roomCode = getDiscordActivityRoomCode();
    roomInput.value = roomCode;
    withFreshLobbyBeforeJoin(roomCode, () => {
        if (role === 'spymaster' && spymasterSlotFullFor(team)) {
            toast(`${teamName(team)} Team already has a spymaster.`);
            setJoinButtonsReady();
            return;
        }
        if (!characterAvailableNow()) {
            toast('That character is already taken. Pick another one first.');
            renderCharacters();
            return;
        }
        const payload = discordJoinPayload(team, role);
        if (!payload) return;
        socket.emit('joinOrCreateActivityRoom', payload, acceptJoinResponse);
    });
}

function sendDiscordIdentityToServer() {
    // Disabled: player names are manual and editable again.
}

async function openDiscordInvite() {
    // Give discord-sdk.js a moment to finish loading
    for (let i = 0; i < 10; i++) {
        if (window.DD_openInviteDialog) break;
        await new Promise(resolve => setTimeout(resolve, 150));
    }

    if (window.DD_openInviteDialog) {
        const res = await window.DD_openInviteDialog();
        if (res?.ok) return;

        toast(res?.error || 'Could not open Discord invite dialog.');
        return;
    }

    toast('Discord invite is not ready yet. Use Discord voice channel invite button.');
}

window.addEventListener('discordActivityReady', (event) => {
    discordActivityInfo = event.detail;

    if (discordActivityInfo?.enabled) {
        isDiscordActivity = true;
        document.body.classList.add('discordActivity');
        ensureDiscordIdentity();
        renderDiscordIdentity();

        discordActivityRoomCode = getDiscordActivityRoomCode();
        roomInput.value = discordActivityRoomCode;

        const roomField = document.querySelector('.websiteRoomField');
        if (roomField) roomField.classList.add('hidden');

        const teamChoice = document.getElementById('teamChoice');
        if (teamChoice) teamChoice.classList.add('hidden');

        const actions = document.querySelector('.actions');
        if (actions) actions.classList.add('hidden');

        const discordLobby = document.getElementById('discordLobby');
        if (discordLobby) discordLobby.classList.remove('hidden');

        const title = document.querySelector('.teamChooseTitle');
        if (title) title.textContent = 'Choose your role';
    }

    syncDiscordLanding();
});
window.addEventListener('discordParticipantsChanged', () => {
    applyDiscordNameToInput(true);
    renderDiscordIdentity();
    refreshDiscordLobbyPreview(true);
    sendDiscordIdentityToServer();
});
window.addEventListener('discordIdentityChanged', () => {
    ensureDiscordIdentity();
    applyDiscordNameToInput(true);
    renderDiscordIdentity();
    setJoinButtonsReady();
    refreshDiscordLobbyPreview(true);
    sendDiscordIdentityToServer();
});
window.addEventListener('discordIdentityError', () => {
    applyDiscordNameToInput(true);
    renderDiscordIdentity();
    setJoinButtonsReady();
});


function pendingLobbyPlayerFor(team, role) {
    if (!selectedTeamChoice || !selectedRoleChoice) return null;
    if (selectedTeamChoice !== team || selectedRoleChoice !== role) return null;
    const name = currentDisplayName();
    if (!name) return null;
    return {
        id: myId || playerKey || 'local-preview',
        name,
        avatar: customAvatar || '',
        discordId: discordUser()?.id || '',
        team,
        role,
        character: outboundCharacter(),
        isAdmin: !!me()?.isAdmin,
        isPreview: true
    };
}

function withPendingLobbyPlayer(players, team, role) {
    const list = Array.isArray(players) ? [...players] : [];
    const pending = pendingLobbyPlayerFor(team, role);
    if (!pending) return list;
    const pendingKey = pending.discordId || pending.id || pending.name;
    const alreadyShown = list.some(p => {
        const key = p?.discordId || p?.id || p?.name;
        if (key && pendingKey && key === pendingKey) return true;
        return String(p?.name || '').trim().toLowerCase() === String(pending.name || '').trim().toLowerCase() &&
            String(p?.team || '') === team && String(p?.role || '') === role;
    });
    if (!alreadyShown) list.push(pending);
    return list;
}

function roleListHtml(players) {
    if (!players || !players.length) return '<div class="discordSeatEmpty">empty</div>';
    const seen = new Set();
    const unique = [];
    for (const p of players) {
        const key = p?.discordId || p?.id || `${p?.name || 'player'}_${unique.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
    }
    return unique.map(p => `<div class="discordSeatMini discordSeatLarge ${p.isPreview ? 'pendingSeat' : ''}">${avatarHtml(p, 'lobbyAvatar')}<span class="seatName">${escapeHtml(p.name || 'Player')}</span>${p.isAdmin ? '<em>Admin</em>' : ''}${p.isPreview ? '<em>You</em>' : ''}</div>`).join('');
}

function paintDiscordLobby(info) {
    if (!info?.ok) return;
    const map = [
        ['blue', 'operative', '.discordGoldCard [data-role="operative"]'],
        ['blue', 'spymaster', '.discordGoldCard [data-role="spymaster"]'],
        ['red', 'operative', '.discordBlackCard [data-role="operative"]'],
        ['red', 'spymaster', '.discordBlackCard [data-role="spymaster"]'],
        ['spectator', 'spectator', '.discordSpectatorCard [data-role="spectator"]']
    ];
    for (const [team, role, selector] of map) {
        const btn = document.querySelector(selector);
        const box = btn?.closest('.discordRoleBox') || btn?.parentElement;
        if (!box) continue;
        let list = box.querySelector('.discordSeatList');
        if (!list) {
            list = document.createElement('div');
            list.className = 'discordSeatList';
            box.appendChild(list);
        }
        const players = withPendingLobbyPlayer(lobbyRolePlayers(team, role), team, role);
        list.innerHTML = roleListHtml(players);
        if (btn && role === 'spymaster') {
            const occupiedByOther = players.some(p => p && !p.isPreview && !sameLocalPlayer(p));
            btn.disabled = occupiedByOther;
            btn.textContent = occupiedByOther ? 'Full' : 'Join';
        }
    }
}

function refreshLandingAdminControls() {
    const p = me();
    const bar = document.getElementById('landingAdminBar');
    const start = document.getElementById('landingStartGameBtn');
    const opts = document.getElementById('landingOptionsWrap');
    if (!bar) return;
    const inLobby = !!(state && state.status === 'lobby');
    const canStart = !!(p?.isAdmin && inLobby);
    // Homepage/lobby should only show Start Game. Options belong on the game page only.
    bar.classList.toggle('hidden', !inLobby);
    if (start) start.classList.toggle('hidden', !canStart);
    if (opts) opts.classList.add('hidden');
}

let lobbyPreviewTimer = null;

function lobbyInfoFromState(s) {
    const players = Object.values(s?.players || {}).filter(p => p.online !== false);
    const roleList = (team, role) => players.filter(p => p.team === team && p.role === role)
        .map(p => ({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            discordId: p.discordId,
            character: p.character,
            isAdmin: !!p.isAdmin
        }));
    const byTeam = team => players.filter(p => p.team === team);
    return {
        ok: true,
        roomId: s?.id || '',
        status: s?.status || 'lobby',
        playersTotal: players.length,
        counts: {blue: byTeam('blue').length, red: byTeam('red').length, spectator: byTeam('spectator').length},
        roles: {
            blue: {operative: roleList('blue', 'operative'), spymaster: roleList('blue', 'spymaster')},
            red: {operative: roleList('red', 'operative'), spymaster: roleList('red', 'spymaster')},
            spectator: {spectator: roleList('spectator', 'spectator')}
        },
        spymasters: {
            blue: roleList('blue', 'spymaster').map(p => p.name),
            red: roleList('red', 'spymaster').map(p => p.name)
        }
    };
}

function applyLobbyInfo(res) {
    if (!res?.ok) return;
    const visibleCode = String(roomInput?.value || '').trim().toUpperCase();
    if (visibleCode && String(res.roomId || '').toUpperCase() !== visibleCode) return;
    lastLobbyInfo = res;
    renderCharacters();
    if (isDiscordActivity) paintDiscordLobby(res);
    setJoinButtonsReady();
}

function characterAvailableNow() {
    return hasCustomAvatar() || (!!selectedCharacter && !usedCharacters().has(selectedCharacter));
}

function refreshDiscordLobbyPreview(force = false) {
    if (!isDiscordActivity || !roomInput) return;
    const code = getDiscordActivityRoomCode();
    if (code) roomInput.value = code;
    if (!force && lobbyPreviewTimer) return;
    lobbyPreviewTimer = setTimeout(() => {
        lobbyPreviewTimer = null;
    }, 650);
    socket.emit('getRoomInfo', {roomId: code}, res => {
        if (res?.ok) applyLobbyInfo(res);
    });
}

function withFreshLobbyBeforeJoin(roomId, proceed) {
    const code = String(roomId || '').trim().toUpperCase();
    if (!code) return proceed();
    socket.emit('getRoomInfo', {roomId: code}, res => {
        if (res?.ok) {
            applyLobbyInfo(res);
            // If another user took the selected character while this tab was open, do not send a stale join.
            // renderCharacters() may auto-select the next free character; if none exists, stop here.
            if (!characterAvailableNow()) {
                toast('That character was just taken. Pick another one first.');
                renderCharacters();
                return;
            }
        }
        proceed();
    });
}

setInterval(() => {
    if (isDiscordActivity && !state) refreshDiscordLobbyPreview(true);
}, 1200);
setInterval(() => {
    if (isDiscordActivity) return;
    if (!landing || landing.classList.contains('hidden')) return;
    if (roomInput?.value.trim()) requestLobbyInfo();
}, 1200);

function setupJoinFlow() {
    const teamSel = $('team'), roleSel = $('role');
    document.querySelectorAll('.teamPick').forEach(btn => {
        btn.onclick = () => {
            selectedTeamChoice = btn.dataset.team;
            selectedRoleChoice = '';
            if (teamSel) teamSel.value = selectedTeamChoice;
            if (roleSel) roleSel.value = selectedTeamChoice === 'spectator' ? 'spectator' : 'operative';
            document.querySelectorAll('.teamPick').forEach(b => b.classList.toggle('selected', b === btn));
            updateJoinSummary();
            setJoinButtonsReady();
            requestLobbyInfo();
            openRolePopup(selectedTeamChoice);
        };
    });
    document.querySelectorAll('.rolePick').forEach(btn => {
        btn.onclick = () => {
            if (btn.disabled || btn.classList.contains('fullRole')) {
                toast(`${teamName(selectedTeamChoice)} Team already has a spymaster.`);
                setJoinButtonsReady();
                return;
            }
            selectedRoleChoice = selectedTeamChoice === 'spectator' ? 'spectator' : btn.dataset.role;
            if (roleSel) roleSel.value = selectedRoleChoice;
            document.querySelectorAll('.rolePick').forEach(b => b.classList.toggle('selected', b.dataset.role === selectedRoleChoice));
            closeRolePopup();
            updateJoinSummary();
            setJoinButtonsReady();
            requestLobbyInfo();
        };
    });
    const close = $('closeRolePopup');
    if (close) close.onclick = closeRolePopup;
    const overlay = $('roleOverlay');
    if (overlay) overlay.onclick = e => {
        if (e.target === overlay) closeRolePopup();
    };
    document.querySelectorAll('.discordRoleJoin').forEach(btn => {
        btn.onclick = () => {
            if (btn.disabled || (btn.dataset.role === 'spymaster' && spymasterSlotFullFor(btn.dataset.team))) {
                toast(`${teamName(btn.dataset.team)} Team already has a spymaster.`);
                setJoinButtonsReady();
                return;
            }
            joinDiscordActivity(btn.dataset.team, btn.dataset.role);
        };
    });
    const di = $('discordInviteBtn');
    if (di) di.onclick = openDiscordInvite;
    if (nameInput) nameInput.addEventListener('input', () => {
        nameWasEditedLocally = true;
        localStorage.cc_name = nameInput.value.trim();
        setJoinButtonsReady();
        updateJoinSummary();
        scheduleProfileSync();
    });
    if (roomInput) roomInput.addEventListener('input', setJoinButtonsReady);
    syncDiscordLanding();
}

setupProfileControls();
setupJoinFlow();
forceBottomOptionsBar();

function joinPayload() {
    localStorage.cc_name = currentDisplayName() || 'Agent';
    const code = isDiscordActivity ? getDiscordActivityRoomCode() : roomInput.value.trim().toUpperCase();
    if (isDiscordActivity) roomInput.value = code;
    return {
        name: currentDisplayName(),
        avatar: customAvatar || '',
        team: $('team').value,
        role: $('role').value,
        character: outboundCharacter(),
        playerKey,
        adminToken: getAdminToken(code)
    };
}

function acceptJoinResponse(res) {
    if (!res.ok) {
        toast(res.error);
        if (isDiscordActivity) refreshDiscordLobbyPreview(true);
        else requestLobbyInfo();
        return;
    }
    if (res.roomId) {
        roomInput.value = res.roomId;
        updateInviteFields(res.roomId);
    }
    if (res.roomId && res.adminToken) storeAdminToken(res.roomId, res.adminToken);
    if (res.playerKey) {
        setPlayerKey(res.playerKey);
    }
    // joinRoom can broadcast the room state before this callback reaches the tab.
    // Re-render immediately after receiving the real seat key so a new tab shows
    // its own chosen team/role instead of the old tab's saved seat.
    if (state) {
        if (isDiscordActivity && state.status === 'lobby') {
            game.classList.add('hidden');
            landing.classList.remove('hidden');
            refreshDiscordLobbyPreview(true);
            refreshLandingAdminControls();
        } else {
            landing.classList.add('hidden');
            game.classList.remove('hidden');
            render();
        }
    }
}

$('createBtn').onclick = () => {
    if (isDiscordActivity) return joinDiscordActivity($('team').value || 'spectator', $('role').value || 'spectator');
    socket.emit('createRoom', joinPayload(), acceptJoinResponse);
};
const singlePlayerBtn = $('singlePlayerBtn');
if (singlePlayerBtn) {
    singlePlayerBtn.onclick = () => {
        const overlay = $('singleDifficultyOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            return;
        }
        startSinglePlayer('medium');
    };
}

function startSinglePlayer(difficulty = 'medium') {
    difficulty = ['easy', 'medium', 'extreme'].includes(difficulty) ? difficulty : 'medium';
    if (singlePlayerBtn) {
        localStorage.cc_name = currentDisplayName() || 'Agent';
        singlePlayerBtn.disabled = true;
        singlePlayerBtn.textContent = 'Starting...';
    }
    socket.emit('createSinglePlayerRoom', {
        name: currentDisplayName(),
        avatar: customAvatar || '',
        character: outboundCharacter(),
        difficulty,
        playerKey
    }, res => {
        if (singlePlayerBtn) {
            singlePlayerBtn.disabled = false;
            singlePlayerBtn.textContent = 'Single Player';
        }
        acceptJoinResponse(res);
    });
}

const singleDifficultyOverlay = $('singleDifficultyOverlay');
const closeSingleDifficulty = $('closeSingleDifficulty');
if (closeSingleDifficulty) closeSingleDifficulty.onclick = () => singleDifficultyOverlay?.classList.add('hidden');
document.querySelectorAll('[data-single-difficulty]').forEach(btn => {
    btn.onclick = () => {
        singleDifficultyOverlay?.classList.add('hidden');
        startSinglePlayer(btn.dataset.singleDifficulty || 'medium');
    };
});
$('joinBtn').onclick = () => {
    if (isDiscordActivity) return joinDiscordActivity($('team').value || 'spectator', $('role').value || 'spectator');
    const roomId = roomInput.value.trim().toUpperCase();
    withFreshLobbyBeforeJoin(roomId, () => {
        if (selectedSpymasterSlotFull()) {
            toast(`${teamName(selectedTeamChoice)} Team already has a spymaster.`);
            setJoinButtonsReady();
            return;
        }
        if (!characterAvailableNow()) {
            toast('That character is already taken. Pick another one first.');
            renderCharacters();
            return;
        }
        socket.emit('joinRoom', {...joinPayload(), roomId}, acceptJoinResponse);
    });
};

socket.on('connect', () => {
    myId = playerKey;
    requestLobbyInfo();
    if (isDiscordActivity) refreshDiscordLobbyPreview(true);
});
socket.on('lobbyInfo', res => {
    applyLobbyInfo(res);
});
socket.on('identityKey', ({playerKey: newKey} = {}) => {
    if (newKey) {
        setPlayerKey(newKey);
    }
});
socket.on('toast', toast);
socket.on('adminRequest', req => {
    const current = me();
    if (!current?.isAdmin || !req) return;
    showAdminRequestPopup(req);
});
socket.on('kicked', ({roomId, message} = {}) => {
    toast(message || 'You were kicked from the room. You can join back if you want.');
    state = null;
    targetIds.clear();
    lastRevealed.clear();
    setPlayerKey(makePlayerKey());
    if (roomId) roomInput.value = roomId;
    game.classList.add('hidden');
    landing.classList.remove('hidden');
    requestLobbyInfo();
    setJoinButtonsReady();
});
socket.on('state', s => {
    const before = state;
    const clueAccepted = before?.status === 'waiting-clue' && s.status === 'guessing' && before?.clue?.at !== s.clue?.at && s.clue;
    const turnChanged = before && before.turn !== s.turn;
    const newFinishedGame = before && before.status !== 'finished' && s.status === 'finished';
    const gameJustStarted = before?.status === 'lobby' && s.status !== 'lobby';
    if (clueAccepted || turnChanged || newFinishedGame) {
        targetIds.clear();
        const cw = $('clueWord');
        if (cw) cw.value = '';
        clueNumberEdited = false;
        lastClueTargetCount = 0;
    }
    state = s;
    myId = playerKey;
    if (isDiscordActivity) sendDiscordIdentityToServer();
    if (isDiscordActivity && s.status === 'lobby') {
        game.classList.add('hidden');
        landing.classList.remove('hidden');
        if (roomInput && s.id) roomInput.value = s.id;
        applyLobbyInfo(lobbyInfoFromState(s));
        refreshDiscordLobbyPreview(true);
        refreshLandingAdminControls();
        return;
    }
    if (gameJustStarted) lastBoardKey = '';
    if (landing && !landing.classList.contains('hidden')) {
        landing.classList.add('hidden');
        game.classList.remove('hidden');
    }
    if (before?.clue?.at !== s.clue?.at && s.clue) sound('clue');
    if (newFinishedGame) sound('gameWin');
    detectRevealSound(before, s);
    render();
    animateScoreChanges(before, s);
    animateNewReveals(before, s);
});

function detectRevealSound(before, now) {
    if (!before) return;
    for (const c of now.board) {
        const old = before.board.find(x => x.id === c.id);
        if (old && !old.revealed && c.revealed) {
            const p = me();
            if (c.color === 'assassin') return sound('assassin');
            if (c.color === 'neutral') return sound('neutral');
            if (p && p.team !== 'spectator') return sound(c.color === p.team ? 'correct' : 'wrong');
            return sound(c.color === 'blue' || c.color === 'red' ? 'correct' : 'neutral');
        }
    }
}


function updateScoreDisplay(gold, black) {
    const goldNum = $('goldScoreNum'), blackNum = $('blackScoreNum');
    const goldBadge = $('goldScoreBadge'), blackBadge = $('blackScoreBadge');
    if (goldNum) goldNum.textContent = gold;
    if (blackNum) blackNum.textContent = black;
    if (goldBadge) goldBadge.setAttribute('aria-label', `Gold remaining cards ${gold}`);
    if (blackBadge) blackBadge.setAttribute('aria-label', `Black remaining cards ${black}`);
}

function animateScoreChanges(before, now) {
    if (!before?.points || !now?.points) return;
    const changes = [
        {team: 'blue', id: 'goldScoreBadge', old: before.points.blue, val: now.points.blue},
        {team: 'red', id: 'blackScoreBadge', old: before.points.red, val: now.points.red}
    ];
    for (const c of changes) {
        if (typeof c.old !== 'number' || typeof c.val !== 'number' || c.val === c.old) continue;
        const el = $(c.id);
        if (!el) continue;
        el.classList.remove('scoreDrop', 'scoreGain');
        void el.offsetWidth;
        el.classList.add(c.val < c.old ? 'scoreDrop' : 'scoreGain');
        const delta = document.createElement('span');
        delta.className = 'scoreDelta';
        delta.textContent = c.val < c.old ? `-${c.old - c.val}` : `+${c.val - c.old}`;
        el.appendChild(delta);
        setTimeout(() => {
            el.classList.remove('scoreDrop', 'scoreGain');
            delta.remove();
        }, 950);
    }
}

function animateNewReveals(before, now) {
    if (!before || !now?.board) return;
    for (const c of now.board) {
        const old = before.board?.find(x => x.id === c.id);
        if (old && !old.revealed && c.revealed && (c.color === 'blue' || c.color === 'red')) {
            flyCardToTeamScore(c);
        }
    }
}

function flyCardToTeamScore(card) {
    requestAnimationFrame(() => {
        const src = document.querySelector(`.card[data-id="${card.id}"]`);
        const dest = card.color === 'blue' ? $('goldSideScore') : $('blackSideScore');
        if (!src || !dest) return;
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
        const dx = b.left + b.width / 2 - (a.left + a.width / 2);
        const dy = b.top + b.height / 2 - (a.top + a.height / 2);
        clone.animate([
            {transform: 'translate(0,0) scale(1)', opacity: .95, filter: 'brightness(1)'},
            {
                transform: `translate(${dx * .55}px,${dy * .35 - 70}px) scale(.74)`,
                opacity: .9,
                filter: 'brightness(1.35)'
            },
            {transform: `translate(${dx}px,${dy}px) scale(.18)`, opacity: 0, filter: 'brightness(1.8)'}
        ], {duration: 850, easing: 'cubic-bezier(.2,.8,.2,1)'}).onfinish = () => clone.remove();
    });
}

function renderWinModal() {
    const modal = $('winModal');
    if (!modal) return;
    const won = state?.status === 'finished' && state?.winner;
    modal.classList.toggle('hidden', !won);
    if (!won) {
        modal.classList.remove('docked', 'winBlue', 'winRed');
        if (winDockTimer) {
            clearTimeout(winDockTimer);
            winDockTimer = null;
        }
        lastWinKey = null;
        return;
    }
    const name = teamUpper(state.winner);
    $('winModalTitle').textContent = `${name} TEAM WON THE GAME!`;
    $('winModalText').textContent = 'Congratulations!';
    const key = `${state.id}-${state.round}-${state.winner}-${state.status}`;
    if (lastWinKey !== key) {
        lastWinKey = key;
        modal.classList.remove('docked', 'winBlue', 'winRed');
        if (winDockTimer) clearTimeout(winDockTimer);
        winDockTimer = setTimeout(() => {
            modal.classList.add('docked', state.winner === 'blue' ? 'winBlue' : 'winRed');
        }, 2000);
    }
}


function render() {
    const p = me();
    const passBtn = $('endTurnBtn');
    if (passBtn) passBtn.textContent = 'PASS';
    const roomLbl = $('roomLabel');
    if (roomLbl) roomLbl.textContent = '';
    updateInviteFields(state.id);
    $('turnBadge').className = `badge ${state.turn}`;
    $('turnBadge').textContent = `${teamUpper(state.turn)} TURN`;
    $('clueBadge').className = `badge turnSubStatus ${state.turn}`;
    $('clueBadge').innerHTML = turnStatusHtml();
    $('winnerBadge').className = state.winner ? `badge ${state.winner}` : 'hidden';
    $('winnerBadge').textContent = state.winner ? `${teamUpper(state.winner)} WINS` : '';
    updateScoreDisplay(state.points?.blue ?? 9, state.points?.red ?? 9);
    const gs = $('goldSideScore'), bs = $('blackSideScore');
    if (gs) gs.textContent = state.points?.blue ?? 9;
    if (bs) bs.textContent = state.points?.red ?? 9;
    const gp = $('goldPanel'), bp = $('blackPanel');
    if (gp) gp.classList.toggle('winnerPanel', state.winner === 'blue');
    if (bp) bp.classList.toggle('winnerPanel', state.winner === 'red');
    renderMe();
    renderPlayers();
    renderSeatControls();
    renderBoard();
    renderPanels();
    renderCurrentClueDock();
    renderVoteConfirm();
    renderLog();
    renderWinModal();
}

function renderCurrentClueDock() {
    const el = $('currentClueDock');
    if (!el) return;
    if (state?.clue && state.status === 'guessing') {
        const team = state.clue.team || state.turn;
        el.className = `currentClueDock glass ${team}`;
        el.innerHTML = `<span class="currentClueLabel">CLUE</span><b>${String(state.clue.word || '').toUpperCase()}</b><strong>${Number(state.clue.number || 0)}</strong>`;
    } else {
        el.className = 'currentClueDock hidden';
        el.innerHTML = '';
    }
}

function renderSeatCharacters() { /* seat editing removed from in-game UI */
}

function renderMe() {
    const p = me();
    if (!p) return;
    $('meCard').innerHTML = `<div class="player ${p.team}">${avatarHtml(p)}<div><b>${p.name}</b><span class="roleTag">${teamName(p.team)} · ${p.role}</span></div></div>`;
}

const mobileTeamOpenState = {goldPanel: false, blackPanel: false};

function ensureMobileTeamToggle(panelId) {
    const panel = $(panelId);
    if (!panel) return;
    const header = panel.querySelector('.teamHeader');
    if (!header) return;
    let btn = header.querySelector('.mobileTeamToggle');
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mobileTeamToggle';
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            mobileTeamOpenState[panelId] = !mobileTeamOpenState[panelId];
            ensureMobileTeamToggles();
        });
        header.appendChild(btn);
    }
    const open = !!mobileTeamOpenState[panelId];
    panel.classList.toggle('mobileTeamOpen', open);
    btn.textContent = open ? 'Hide Team' : 'Show Team';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function ensureMobileTeamToggles() {
    ensureMobileTeamToggle('goldPanel');
    ensureMobileTeamToggle('blackPanel');
}

function ownerWrapForFloatingMenu(menu) {
    const ownerId = menu?.dataset?.ownerPlayerId || '';
    if (!ownerId) return null;
    return [...document.querySelectorAll('.playerOptionsWrap')].find(wrap =>
        wrap.querySelector('[data-player-options]')?.dataset.playerOptions === ownerId
    ) || null;
}

function closePlayerOptionsMenus(exceptWrap = null) {
    document.querySelectorAll('.playerOptionsWrap.open').forEach(wrap => {
        if (wrap !== exceptWrap) wrap.classList.remove('open');
    });
    document.querySelectorAll('body > .playerOptionsMenu.floatingPlayerOptions').forEach(menu => {
        const owner = ownerWrapForFloatingMenu(menu);
        if (owner && owner !== exceptWrap) {
            menu.classList.remove('floatingPlayerOptions');
            menu.style.left = '';
            menu.style.top = '';
            menu.style.right = '';
            menu.style.bottom = '';
            owner.appendChild(menu);
        } else if (!owner) {
            menu.remove();
        }
    });
}

function openPlayerOptionsMenu(wrap, btn) {
    const menu = wrap.querySelector('.playerOptionsMenu');
    if (!menu) return;
    wrap.classList.add('open');
    menu.dataset.ownerPlayerId = btn.dataset.playerOptions || '';
    menu.classList.add('floatingPlayerOptions');
    document.body.appendChild(menu);

    const rect = btn.getBoundingClientRect();
    const menuWidth = Math.min(180, Math.max(132, menu.offsetWidth || 150));
    const menuHeight = Math.max(104, menu.offsetHeight || 112);
    const pad = 8;
    let left = rect.left;
    let top = rect.bottom + 7;
    if (left + menuWidth > window.innerWidth - pad) left = window.innerWidth - menuWidth - pad;
    if (left < pad) left = pad;
    if (top + menuHeight > window.innerHeight - pad) top = rect.top - menuHeight - 7;
    if (top < pad) top = pad;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}


function renderPlayers() {
    closePlayerOptionsMenus();
    const current = me();
    const adminMode = !!current?.isAdmin;
    const playerOptionsMode = !!(current?.isAdmin || current?.role === 'spymaster');
    const teams = {
        blue: {operative: [], spymaster: []},
        red: {operative: [], spymaster: []},
        spectator: {spectator: []}
    };
    Object.values(state.players).forEach(p => {
        const t = p.team || 'spectator';
        if (t === 'spectator') teams.spectator.spectator.push(p);
        else if (p.role === 'spymaster') teams[t].spymaster.push(p);
        else teams[t].operative.push(p);
    });

    function adminTools(p) {
        if (!playerOptionsMode || p.id === myId) return '';
        return `<div class="adminActions playerOptionsWrap">
            <button class="playerOptionsBtn" type="button" data-player-options="${p.id}">Options ▾</button>
            <div class="playerOptionsMenu">
                <button type="button" data-admin-kick="${p.id}">Kick</button>
                <button type="button" data-admin-assign="${p.id}">Assign Admin</button>
                <button type="button" data-admin-rename="${p.id}" data-player-name="${escapeHtml(p.name || 'Player')}">Change Name</button>
            </div>
        </div>`;
    }

    function playerHtml(p) {
        const offline = p.online === false;
        const adminBadge = p.isAdmin ? '<span class="adminBadge adminCrown" title="Admin">👑</span>' : '';
        const canDrag = playerOptionsMode && p.id !== myId && (!p.isAdmin || adminMode);
        return `<div class="player ${p.team} ${offline ? 'offline' : ''} ${canDrag ? 'draggablePlayer' : ''} ${p.isAdmin ? 'adminPlayer' : ''}" data-player-id="${p.id}" draggable="${canDrag ? 'true' : 'false'}">${avatarHtml(p)}<div class="playerBody"><b class="${p.isAdmin ? 'adminNameLine' : ''}"><span class="playerNameText">${escapeHtml(p.name || 'Player')}</span>${adminBadge}${offline ? '<span class="offlineIcon" title="Offline">📡</span>' : ''}</b>${adminTools(p)}</div></div>`;
    }

    function hexToRgba(hex, alpha = 1) {
        const clean = String(hex || '#71e2ff').replace('#', '');
        const r = parseInt(clean.slice(0, 2), 16);
        const g = parseInt(clean.slice(2, 4), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function empty(text) {
        return `<div class="emptyTeamSlot">${text}</div>`;
    }

    $('goldOperatives').innerHTML = teams.blue.operative.map(playerHtml).join('') || empty('No operatives yet');
    $('goldSpymasters').innerHTML = teams.blue.spymaster.map(playerHtml).join('') || empty('No spymaster yet');
    $('blackOperatives').innerHTML = teams.red.operative.map(playerHtml).join('') || empty('No operatives yet');
    $('blackSpymasters').innerHTML = teams.red.spymaster.map(playerHtml).join('') || empty('No spymaster yet');
    $('spectators').innerHTML = teams.spectator.spectator.map(playerHtml).join('') || empty('No spectators');
    ['goldSpymasters', 'blackSpymasters', 'spectators'].forEach(id => {
        const section = $(id)?.closest('section');
        if (section) section.classList.toggle('hidden', !!state?.singlePlayer);
    });
    document.querySelectorAll('[data-player-options]').forEach(btn => {
        btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const wrap = btn.closest('.playerOptionsWrap');
            const open = !wrap?.classList.contains('open');
            closePlayerOptionsMenus(open ? wrap : null);
            if (wrap && open) openPlayerOptionsMenu(wrap, btn);
        };
    });
    document.querySelectorAll('[data-admin-kick]').forEach(btn => {
        btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            closePlayerOptionsMenus();
            const target = btn.dataset.adminKick;
            socket.emit('adminUpdatePlayer', {playerId: target, action: 'kick'});
        };
    });
    document.querySelectorAll('[data-admin-assign]').forEach(btn => {
        btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            closePlayerOptionsMenus();
            const target = btn.dataset.adminAssign;
            socket.emit('adminUpdatePlayer', {playerId: target, action: 'assignAdmin'});
        };
    });
    document.querySelectorAll('[data-admin-rename]').forEach(btn => {
        btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            closePlayerOptionsMenus();
            const target = btn.dataset.adminRename;
            const currentName = btn.dataset.playerName || '';
            const nextName = prompt('Change player name:', currentName);
            if (nextName === null) return;
            const cleanName = String(nextName || '').trim();
            if (!cleanName) return toast('Name cannot be empty.');
            socket.emit('adminUpdatePlayer', {playerId: target, action: 'changeName', name: cleanName});
        };
    });
    if (!window.__ddPlayerOptionsOutsideClickReady) {
        window.__ddPlayerOptionsOutsideClickReady = true;
        document.addEventListener('click', ev => {
            if (ev.target.closest('.playerOptionsWrap') || ev.target.closest('.playerOptionsMenu')) return;
            closePlayerOptionsMenus();
        });
        document.addEventListener('keydown', ev => {
            if (ev.key !== 'Escape') return;
            closePlayerOptionsMenus();
        });
        window.addEventListener('resize', () => closePlayerOptionsMenus());
    }
    setupAdminDragAndDrop(playerOptionsMode);
    applyActiveTurnHighlight();
    const goldCount = teams.blue.operative.length + teams.blue.spymaster.length;
    const blackCount = teams.red.operative.length + teams.red.spymaster.length;
    const gc = $('goldPlayerCount'), bc = $('blackPlayerCount');
    if (gc) gc.textContent = `${goldCount} player${goldCount === 1 ? '' : 's'}`;
    if (bc) bc.textContent = `${blackCount} player${blackCount === 1 ? '' : 's'}`;
    ensureMobileTeamToggles();
}


function activeRoleForTurn() {
    if (!state || state.status === 'finished' || state.status === 'lobby') return '';
    if (state.status === 'waiting-clue') return 'spymaster';
    if (state.status === 'guessing') return 'operative';
    return '';
}

function applyActiveTurnHighlight() {
    const activeRole = activeRoleForTurn();
    const activeTeam = state?.turn || '';
    const goldPanel = $('goldPanel'), blackPanel = $('blackPanel');
    [goldPanel, blackPanel].forEach(panel => panel?.classList.remove('activeTurnPanel', 'dimTurnPanel'));
    if (activeRole && activeTeam) {
        const activePanel = activeTeam === 'blue' ? goldPanel : blackPanel;
        const dimPanel = activeTeam === 'blue' ? blackPanel : goldPanel;
        activePanel?.classList.add('activeTurnPanel');
        dimPanel?.classList.add('dimTurnPanel');
    }
    document.querySelectorAll('.player').forEach(el => {
        const pid = el.dataset.playerId;
        const p = pid ? state?.players?.[pid] : null;
        const isActive = !!(p && activeRole && p.online !== false && p.team === activeTeam && p.role === activeRole);
        const isOtherPlayingMember = !!(p && activeRole && p.team !== 'spectator' && !isActive);
        el.classList.toggle('activeTurnPlayer', isActive);
        el.classList.toggle('dimTurnPlayer', isOtherPlayingMember);
    });
}

function forceBottomOptionsBar() {
    const bar = $('adminControlBar');
    const g = $('game');
    if (!bar || !g) return;
    if (bar.parentElement !== g) g.appendChild(bar);
    bar.classList.add('bottomOptionsBar');
}

function renderSeatControls() {
    forceBottomOptionsBar();
    const p = me();
    const canOptions = !!(p?.isAdmin || p?.role === 'spymaster');
    const bar = $('adminControlBar');
    if (bar) {
        bar.classList.toggle('hidden', !canOptions);
        bar.classList.toggle('nonAdminControls', false);
        bar.title = p?.isAdmin ? 'Admin controls' : (p?.role === 'spymaster' ? 'Spymaster controls' : '');
    }
}

function setupSectionJoinButtons() { /* in-game self switching removed; admin moves players only */
}

function setupAdminDragAndDrop(adminMode) {
    document.querySelectorAll('.draggablePlayer').forEach(el => {
        el.ondragstart = (ev) => {
            if (!adminMode) return ev.preventDefault();
            ev.dataTransfer.setData('text/plain', el.dataset.playerId);
            ev.dataTransfer.effectAllowed = 'move';
            el.classList.add('dragging');
        };
        el.ondragend = () => el.classList.remove('dragging');
    });
    document.querySelectorAll('[data-drop-team]').forEach(zone => {
        zone.ondragover = (ev) => {
            if (adminMode) {
                ev.preventDefault();
                zone.classList.add('dropReady');
            }
        };
        zone.ondragleave = () => zone.classList.remove('dropReady');
        zone.ondrop = (ev) => {
            if (!adminMode) return;
            ev.preventDefault();
            zone.classList.remove('dropReady');
            const playerId = ev.dataTransfer.getData('text/plain');
            if (playerId) socket.emit('adminUpdatePlayer', {
                playerId,
                action: 'move',
                team: zone.dataset.dropTeam,
                role: zone.dataset.dropRole
            });
        };
    });
}

function syncClueCount() {
    const n = targetIds.size;
    const num = $('clueNumber');
    if (num) {
        const current = parseInt(num.value, 10);
        if (!clueNumberEdited || Number.isNaN(current) || lastClueTargetCount !== n) {
            num.value = n;
            clueNumberEdited = false;
        }
    }
    lastClueTargetCount = n;
    const btn = $('giveClueBtn');
    const p = me();
    const hintMode = !!(state?.hintRequested && p && state.hintRequested.team === p.team && p.team === state?.turn);
    const isCurrentSpy = p?.role === 'spymaster' && p.team === state?.turn && (state?.status === 'waiting-clue' || (hintMode && state?.status === 'guessing'));
    if (btn) btn.disabled = !isCurrentSpy || (!hintMode && n < 1);
}

function teamOperativesOnline(team) {
    return Object.values(state?.players || {}).filter(p => p.online !== false && p.team === team && p.role === 'operative');
}

function myMarkedIds() {
    const v = state?.voteInfo?.votes?.[myId];
    return Array.isArray(v) ? v : (v !== undefined && v !== null ? [v] : []);
}

function votersForCard(cardId) {
    const votes = state?.voteInfo?.votes || {};
    return Object.entries(votes)
        .filter(([_, value]) => {
            const ids = Array.isArray(value) ? value : (value !== undefined && value !== null ? [value] : []);
            return ids.map(Number).includes(Number(cardId));
        })
        .map(([pid]) => state?.players?.[pid])
        .filter(Boolean);
}

function voteFacesHtml(cardId) {
    const voters = votersForCard(cardId);
    if (!voters.length) return '';
    return `<div class="voteFaces">${voters.slice(0, 4).map(p => {
        const av = playerAvatar(p);
        const title = `${p.name || 'Player'} picked this card`;
        return av ? `<span class="voteFace" title="${title}"><img src="${av}" alt="${p.name || 'player'}"></span>` : `<span class="voteFace fallback" title="${title}">${charEmoji(p.character)}</span>`;
    }).join('')}${voters.length > 4 ? `<span class="voteFace more">+${voters.length - 4}</span>` : ''}</div>`;
}

function canConfirmVote() {
    return false;
}

function renderVoteConfirm() {
    const btn = $('confirmVoteBtn');
    if (btn) btn.classList.add('hidden');
}


function cardLengthClass(word) {
    const l = String(word || '').length;
    if (l <= 6) return 'shortWord';
    if (l <= 9) return 'mediumWord';
    return 'longWord';
}

function revealHeroSvg(color) {
    return '';
}

function renderBoard() {
    if (state?.status === 'lobby') {
        board.classList.remove('spyBoard', 'operativeBoard');
        board.innerHTML = '<div class="waitingBoard">Waiting for admin to start the game...</div>';
        return;
    }
    const p = me();
    const spy = p?.role === 'spymaster';
    board.classList.toggle('spyBoard', !!spy);
    board.classList.toggle('operativeBoard', !spy);
    board.classList.toggle('finishedBoard', state.status === 'finished');
    const marked = myMarkedIds();
    // Spawn animation should happen only for a truly fresh board, not for votes/reveals/turn changes.
    // Do not include visible colors, revealed state, votes, or round number here because those
    // change during normal play and would reanimate every card.
    const boardKey = `${state.id}-${state.board.map(c => `${c.id}:${c.word}`).join('|')}`;
    const shouldSpawn = boardKey !== lastBoardKey;
    lastBoardKey = boardKey;
    board.innerHTML = state.board.map((c, i) => {
        const showOrigin = state.status === 'finished';
        const pendingReveal = false;
        const visuallyRevealed = !!c.revealed;
        const colorClass = ((visuallyRevealed || spy || showOrigin) && c.color) ? c.color : '';
        // Spymaster clue-target selections should show the crown only, without the old cyan border/tick.
        const spyClueTarget = !c.revealed && spy && (c.clueTarget || targetIds.has(c.id));
        const voteCount = state.voteInfo?.counts?.[c.id] || 0;
        const agreed = state.voteInfo?.agreedCardId === c.id;
        const myVote = marked.includes(c.id);
        const voted = voteCount > 0;
        const revealer = c.revealedById ? state?.players?.[c.revealedById] : null;
        // During play, revealed team/grey cards become crown-only. After the win, show every real word/color.
        const teamReveal = !!(!showOrigin && visuallyRevealed && (c.color === 'blue' || c.color === 'red'));
        const correctReveal = teamReveal;
        const neutralReveal = !!(!showOrigin && visuallyRevealed && c.color === 'neutral');
        const playableSpyTarget = spy && p?.team === state.turn && state.status === 'waiting-clue' && c.color === p.team && !c.revealed;
        const canConfirmThis = p?.role === 'operative' && p.team === state.turn && state.status === 'guessing' && myVote && !c.revealed;
        const voteBadge = '';
        const voteFaces = voted && !c.revealed ? voteFacesHtml(c.id) : '';
        const confirmMini = canConfirmThis ? `<span class="cardConfirm" data-confirm-id="${c.id}" title="Confirm ${c.word}">✓</span>` : '';
        const revealBadge = visuallyRevealed ? revealHeroSvg(c.color) : '';
        // Use a real centered crown layer instead of card backgrounds/pseudo-elements.
        // This avoids mobile Safari/Discord cropping the crown into the top-left corner.
        const crownSrc = neutralReveal ? '/crown-bw.png' : '/crown.png';
        const hasCrownLayer = spyClueTarget || teamReveal || neutralReveal;
        const crownLayer = hasCrownLayer ? `<img class="cardCrownLayer ${neutralReveal ? 'cardCrownBwLayer' : ''}" src="${crownSrc}" alt="" aria-hidden="true">` : '';
        const crownOnlyReveal = teamReveal || neutralReveal;
        const wordLayer = crownOnlyReveal ? '' : `<span class="word ${cardLengthClass(c.word)}" style="--letters:${String(c.word).length}">${c.word}</span>`;
        return `<button class="card ${shouldSpawn ? 'spawnCard' : ''} ${colorClass} ${c.revealed ? 'revealed' : ''} ${pendingReveal ? 'pendingReveal' : ''} ${correctReveal ? 'correctReveal' : ''} ${teamReveal ? 'teamReveal' : ''} ${neutralReveal ? 'neutralReveal' : ''} ${crownOnlyReveal ? 'crownOnlyReveal' : ''} ${showOrigin ? 'originShown finalOriginShown' : ''} ${spyClueTarget ? 'spyClueTarget' : ''} ${hasCrownLayer ? 'hasCrownLayer' : ''} ${playableSpyTarget ? 'spyPickable' : ''} ${voted ? 'voted pickedByOperative' : ''} ${c.revealed ? 'pickedByOperative' : ''} ${agreed ? 'agreed' : ''} ${myVote ? 'myVote' : ''}" data-id="${c.id}" title="${c.word}" style="--spawn:${i}">${revealBadge}${crownLayer}${wordLayer}${voteBadge}${voteFaces}${confirmMini}</button>`;
    }).join('');
    board.querySelectorAll('.card').forEach(el => {
        el.onclick = (ev) => {
            if (ev.target.closest('.cardConfirm')) return;
            const id = Number(el.dataset.id);
            const card = state.board.find(c => c.id === id);
            const p = me();
            if (!p || !card || card.revealed || state.status === 'finished') return;
            if (p.role === 'spymaster') {
                if (state.status !== 'waiting-clue') {
                    toast('Wait for the clue turn before choosing cards.');
                    return;
                }
                if (p.team !== state.turn) {
                    toast(`It is ${teamName(state.turn)} Team's turn, not your team.`);
                    return;
                }
                if (state?.hintRequested && state.hintRequested.team === p.team) {
                    toast('Extra hints do not need card selection.');
                    return;
                }
                if (card.color == null) {
                    toast('Card color is still loading. Try again in a second.');
                    return;
                }
                if (card.color !== p.team) {
                    toast('Spymasters can only choose cards from their own team color.');
                    return;
                }
                targetIds.has(id) ? targetIds.delete(id) : targetIds.add(id);
                renderBoard();
                syncClueCount();
                return;
            }
            if (p.role === 'operative' && p.team === state.turn && state.status === 'guessing') {
                socket.emit('voteCard', {id});
            }
        };
    });
    board.querySelectorAll('.cardConfirm').forEach(btn => {
        btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            socket.emit('confirmVote', {id: Number(btn.dataset.confirmId)});
        };
    });
    syncClueCount();
}

function renderPanels() {
    const p = me();
    const canOptions = !!(p?.isAdmin || p?.role === 'spymaster');
    const adminBar = $('adminControlBar');
    if (adminBar) {
        adminBar.classList.remove('nonAdminControls');
        adminBar.classList.toggle('hidden', !canOptions);
        adminBar.classList.toggle('viewerOptions', false);
        if (!canOptions) adminBar.querySelectorAll('.optionsWrap.open').forEach(w => w.classList.remove('open'));
    }
    if (state?.status === 'lobby') {
        const cs = $('clueStatus');
        if (cs) cs.innerHTML = '';
    }
    const turnSpy = spymasterName(state.turn);
    const hintModeForSpy = !!(state?.hintRequested && p?.role === 'spymaster' && state.hintRequested.team === p.team && p.team === state.turn);
    const isCurrentSpy = p?.role === 'spymaster' && p.team === state.turn && (state.status === 'waiting-clue' || hintModeForSpy);
    const isAnySpy = p?.role === 'spymaster';
    const isOp = p?.role === 'operative' && p.team === state.turn;
    const canClaim = p && p.team === state.turn && p.role !== 'spymaster' && !hasOnlineSpymaster(state.turn) && state.status === 'waiting-clue';
    $('spymasterPanel').classList.add('hidden');
    const opActive = !!(p?.role === 'operative' && p.team === state.turn && (state.status === 'guessing' || (!state.singlePlayer && state.status === 'waiting-clue')));
    const topActions = $('topOperativeActions');
    if (topActions) topActions.classList.toggle('hidden', !opActive);
    $('operativePanel').classList.toggle('hidden', !opActive);
    const hintBtn = $('requestHintBtn');
    if (hintBtn) hintBtn.classList.add('hidden');
    $('endTurnBtn').disabled = !(p?.role === 'operative' && p.team === state.turn && state.status === 'guessing');

    const dock = $('bottomClueDock');
    if (dock) {
        const clueAlreadyShown = !!(state?.clue && state.status === 'guessing');
        dock.classList.toggle('hidden', !isAnySpy || clueAlreadyShown);
        $('clueWord').disabled = !isCurrentSpy;
        $('clueNumber').readOnly = false;
        $('clueNumber').disabled = !isCurrentSpy;
        syncClueCount();
        if (isCurrentSpy) {
            $('dockTitle').textContent = 'Give Clue';
            $('dockHelp').textContent = '';
        } else if (isAnySpy) {
            $('dockTitle').textContent = 'Waiting';
            $('dockHelp').textContent = '';
        }
    }

    const newRound = $('newRoundBtn');
    if (newRound) newRound.classList.toggle('hidden', state.status !== 'finished');
    const cs = $('clueStatus');
    if (cs) cs.innerHTML = '';
}

function renderLog() {
    function characterForName(name, team) {
        const n = String(name || '').toLowerCase();
        const p = Object.values(state?.players || {}).find(p => String(p.name || '').toLowerCase() === n && (!team || p.team === team))
            || Object.values(state?.players || {}).find(p => String(p.name || '').toLowerCase() === n);
        return p?.character || 'raiden';
    }

    function logFace(character, by, cls, avatar = '') {
        const ch = character || characterForName(by);
        const src = safeAvatarSrc(avatar);
        const title = escapeHtml(by || 'player');
        if (src) return `<span class="${cls} characterLogFace customAvatar" style="--a:${charAccent(ch)}" title="${title}"><img src="${src}" alt="${title}"></span>`;
        return `<span class="${cls} characterLogFace" style="--a:${charAccent(ch)}" title="${title}">${charEmoji(ch)}</span>`;
    }

    function lenClass(word) {
        const l = String(word || '').length;
        return l > 12 ? 'logLenXL' : l > 8 ? 'logLenLong' : l > 5 ? 'logLenMed' : 'logLenShort';
    }

    function entryTeam(x) {
        const parts = String(x || '').split('|');
        if (parts[0] === 'HINT') return parts[1] || '';
        if (parts[0] === 'PICK') return parts[1] || '';
        if (parts[0] === 'PASS') return parts[1] || '';
        return '';
    }

    function hintHtml(parts) {
        const team = parts[1];
        const word = parts[2] || '';
        const num = parts[3] || '';
        const by = parts[4] || '';
        const avatar = parts[5] || '';
        const character = parts[6] || characterForName(by, team);
        const face = logFace(character, by, 'logSpyAvatar', avatar);
        return `<div class="gameLogEntry hintLog ${team} ${lenClass(word)}">${face}<b>${word}</b><span>${num}</span></div>`;
    }

    function pickHtml(parts) {
        const team = parts[1];
        const color = parts[2];
        const word = parts[3] || '';
        const by = parts[4] || '';
        const avatar = parts[5] || '';
        const character = parts[6] || characterForName(by, team);
        const face = logFace(character, by, 'logUserAvatar', avatar);
        return `<div class="gameLogEntry pickLog ${color} ${lenClass(word)}" title="${by || 'Player'} chose ${word}"><b class="logPickWord">${face}<span>${word}</span></b></div>`;
    }

    function passHtml(parts) {
        const team = parts[1];
        const by = parts[2] || '';
        const avatar = parts[3] || '';
        const character = parts[4] || characterForName(by, team);
        const face = logFace(character, by, 'logUserAvatar', avatar);
        return `<div class="gameLogEntry passLog ${team}" title="${by || 'Player'} passed"><b class="logPickWord">${face}<span class="teamTick">✓</span></b></div>`;
    }

    const entries = (state.log || []).filter(x => ['blue', 'red'].includes(entryTeam(x)));
    const rounds = [];
    let current = null;
    for (const raw of entries) {
        const parts = String(raw || '').split('|');
        if (parts[0] === 'HINT') {
            current = {hint: parts, picks: []};
            rounds.push(current);
        } else if (parts[0] === 'PICK' || parts[0] === 'PASS') {
            if (!current || current.hint?.[1] !== parts[1]) {
                current = {hint: null, picks: []};
                rounds.push(current);
            }
            current.picks.push(parts);
        }
    }
    const html = rounds.length ? `<div class="logRounds">${rounds.map(r => `
    <div class="logRound">
      ${r.hint ? hintHtml(r.hint) : ''}
      <div class="logPicks">${r.picks.map(parts => parts[0] === 'PICK' ? pickHtml(parts) : passHtml(parts)).join('')}</div>
    </div>`).join('')}</div>` : '<div class="gameLogEmpty">No guesses yet</div>';
    const mainLog = $('log');
    if (mainLog) {
        mainLog.innerHTML = html;
        requestAnimationFrame(() => {
            mainLog.scrollTop = mainLog.scrollHeight;
        });
    }
    const hiddenLog = $('logHidden');
    if (hiddenLog) {
        hiddenLog.innerHTML = html;
        requestAnimationFrame(() => {
            hiddenLog.scrollTop = hiddenLog.scrollHeight;
        });
    }
}

const adminRequestYes = $('adminRequestYes');
if (adminRequestYes) adminRequestYes.onclick = () => {
    if (!pendingAdminRequest) return closeAdminRequestPopup();
    const req = pendingAdminRequest;
    closeAdminRequestPopup();
    socket.emit('adminRequestDecision', {requestId: req.requestId, approved: true});
};
const adminRequestNo = $('adminRequestNo');
if (adminRequestNo) adminRequestNo.onclick = () => {
    if (!pendingAdminRequest) return closeAdminRequestPopup();
    const req = pendingAdminRequest;
    closeAdminRequestPopup();
    socket.emit('adminRequestDecision', {requestId: req.requestId, approved: false});
};
const switchBtn = $('switchBtn');
if (switchBtn) switchBtn.onclick = () => socket.emit('switchSeat', {
    team: $('seatTeam')?.value,
    role: $('seatRole')?.value,
    character: $('seatCharacter')?.value
});
const randomBtn = $('randomBtn');
if (randomBtn) randomBtn.onclick = () => socket.emit('randomizeTeams');

function runOrRequestAdminAction(action, label, confirmText) {
    const current = me();
    if (!current) {
        toast('Join the room first.');
        return;
    }

    // Discord Activities / iframes can silently block native confirm() dialogs,
    // so the Options buttons must not depend on confirm() to run.
    if (current.isAdmin || current.role === 'spymaster') {
        targetIds.clear();
        socket.emit(action);
        toast(`${label || 'Option'} applied.`);
        return;
    }

    // Non-admin players can still use the menu by sending a request to the room admin.
    socket.emit('adminActionRequest', {action});
}

const startGameBtn = $('startGameBtn');
if (startGameBtn) startGameBtn.onclick = () => socket.emit('startGame');
const landingStartGameBtn = $('landingStartGameBtn');
if (landingStartGameBtn) landingStartGameBtn.onclick = () => socket.emit('startGame');

function wireOptionButton(id, action, label, text) {
    const b = $(id);
    if (b) b.onclick = () => {
        b.closest('.optionsWrap')?.classList.remove('open');
        runOrRequestAdminAction(action, label, text);
    };
}

function setupOptionsToggles() {
    document.querySelectorAll('.optionsWrap').forEach(wrap => {
        const btn = wrap.querySelector('.optionsBtn');
        if (!btn || btn.dataset.toggleReady === '1') return;
        btn.dataset.toggleReady = '1';
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const willOpen = !wrap.classList.contains('open');
            document.querySelectorAll('.optionsWrap.open').forEach(other => {
                if (other !== wrap) other.classList.remove('open');
            });
            wrap.classList.toggle('open', willOpen);
        });
    });
    if (!window.__ddOptionsOutsideClickReady) {
        window.__ddOptionsOutsideClickReady = true;
        document.addEventListener('click', ev => {
            if (ev.target.closest('.optionsWrap')) return;
            document.querySelectorAll('.optionsWrap.open').forEach(wrap => wrap.classList.remove('open'));
        });
        document.addEventListener('keydown', ev => {
            if (ev.key !== 'Escape') return;
            document.querySelectorAll('.optionsWrap.open').forEach(wrap => wrap.classList.remove('open'));
        });
    }
}

setupOptionsToggles();

wireOptionButton('resetTableBtn', 'resetTable', 'Reset Table', 'Reset the table with a fresh board but keep the same room and players?');
wireOptionButton('shuffleTeamsBtn', 'shuffleTeams', 'Shuffle Teams', 'Shuffle online players between Gold and Black teams?');
wireOptionButton('changeWordListBtn', 'changeWordList', 'Change Word List', 'Change the word list / deal a fresh board in this same room?');
wireOptionButton('landingResetTableBtn', 'resetTable', 'Reset Table', 'Reset the table with a fresh board but keep the same room and players?');
wireOptionButton('landingShuffleTeamsBtn', 'shuffleTeams', 'Shuffle Teams', 'Shuffle online players between Gold and Black teams?');
wireOptionButton('landingChangeWordListBtn', 'changeWordList', 'Change Word List', 'Change the word list / deal a fresh board in this same room?');
const newGameBtn = $('newGameBtn');
if (newGameBtn) newGameBtn.onclick = () => {
    if (confirm('Start a new board in this room?')) {
        targetIds.clear();
        socket.emit('newGame');
    }
};
$('giveClueBtn').onclick = () => {
    const targets = [...targetIds];
    const clueWord = $('clueWord').value.trim();
    const clueNumberValue = Math.max(0, Math.min(9, parseInt($('clueNumber')?.value || targets.length, 10) || 0));
    const p = me();
    const hintMode = !!(state?.hintRequested && p && state.hintRequested.team === p.team);
    if (!clueWord) {
        toast('Write a clue word first.');
        return;
    }
    if (!hintMode && targets.length < 1) {
        toast('Pick at least one of your team cards first.');
        return;
    }
    socket.emit('giveClue', {word: clueWord, number: clueNumberValue, targetIds: targets});
};
const clueNumberInput = $('clueNumber');
if (clueNumberInput) {
    clueNumberInput.addEventListener('input', () => {
        clueNumberEdited = true;
        const value = Math.max(0, Math.min(9, parseInt(clueNumberInput.value || '0', 10) || 0));
        clueNumberInput.value = value;
        syncClueCount();
    });
}
const newRoundBtn = $('newRoundBtn');
if (newRoundBtn) newRoundBtn.onclick = () => {
    targetIds.clear();
    socket.emit('newGame');
};
const requestHintBtn = $('requestHintBtn');
if (requestHintBtn) requestHintBtn.onclick = () => {
};
$('endTurnBtn').onclick = () => socket.emit('endTurn');
const confirmVoteBtn = $('confirmVoteBtn');
if (confirmVoteBtn) confirmVoteBtn.onclick = () => socket.emit('confirmVote', {id: myMarkedIds()[0]});
const inviteBtn = $('inviteBtn');
if (inviteBtn) inviteBtn.onclick = async () => {
    updateInviteFields(state?.id || roomInput.value);
    const link = $('inviteLinkGame')?.value;
    if (link && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(link);
            toast('Invite link copied.');
        } catch {
            toast('Invite link ready.');
        }
    } else toast('Invite link ready.');
};
const topInviteBtn = $('topInviteBtn');
if (topInviteBtn) topInviteBtn.onclick = async () => {
    if (isDiscordActivity) return openDiscordInvite();
    updateInviteFields(state?.id || roomInput.value);
    const link = $('topInviteLink')?.value;
    if (link && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(link);
            toast('Invite link copied.');
        } catch {
            toast('Invite link ready.');
        }
    } else toast('Invite link ready.');
};
const backToLobbyBtn = $('backToLobbyBtn');
if (backToLobbyBtn) backToLobbyBtn.onclick = () => {
    const currentRoom = state?.id || roomInput.value.trim().toUpperCase();
    socket.emit('leaveToLobby', () => {
        state = null;
        targetIds.clear();
        lastRevealed.clear();
        setPlayerKey(makePlayerKey());
        if (currentRoom) roomInput.value = currentRoom;
        selectedTeamChoice = '';
        selectedRoleChoice = '';
        document.querySelectorAll('.teamPick,.rolePick').forEach(b => b.classList.remove('selected'));
        updateJoinSummary();
        setJoinButtonsReady();
        requestLobbyInfo();
        game.classList.add('hidden');
        landing.classList.remove('hidden');
        toast('Choose a new team or role, then join again.');
    });
};
setInterval(() => {
    if (!state) return;
    $('roundTime').textContent = fmt(Date.now() - state.roundStartedAt);
    $('gameTime').textContent = fmt(Date.now() - state.gameStartedAt);
}, 500);
