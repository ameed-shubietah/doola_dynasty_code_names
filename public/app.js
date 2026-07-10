const initialUiLanguage = localStorage.cc_language === 'ar' ? 'ar' : 'en';
const socket = io({auth: {language: initialUiLanguage}});
let state = null, selectedCharacter = 'raiden', targetIds = new Set(), lastRevealed = new Set();
const localFlippedPickedCards = new Set();
let lastWinKey = null, winDockTimer = null, lastGameWinSoundKey = null, delayedWinRevealTimer = null, winRevealHoldUntil = 0, hiddenWinEffectKey = '';
let lastBoardKey = '', lastBoardSpawnAt = 0;
let gameIntroTimer = null, lastIntroKey = '';
let reactionTimer = null;
let clueSplashTimer = null, lastClueSplashKey = '';

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
const MAX_CLUE_TARGETS = 25;
const pendingRevealIds = new Set();
const REVEAL_ASCEND_MS = 1650;
const delayedRevealTimers = new Map();
const delayedRevealTokens = new Map();
const delayedRevealReactions = new Map();
const revealLiftGhosts = new Map();

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
let uiLanguage = initialUiLanguage;
if (nameInput) nameInput.value = localStorage.cc_name || '';

const BACKGROUND_THEMES = [
    {id: 'royal-noir', en: 'Royal Gold', ar: 'ذهبي ملكي'},
    {id: 'violet-crown', en: 'Violet Crown', ar: 'تاج بنفسجي'},
    {id: 'ember-royal', en: 'Ember Royal', ar: 'جمرة ملكية'},
    {id: 'emerald-night', en: 'Emerald Night', ar: 'ليلة زمردية'},
    {id: 'azure-luxe', en: 'Azure Luxe', ar: 'أزرق فاخر'},
    {id: 'obsidian-rose', en: 'Obsidian Rose', ar: 'وردة أوبسيديان'}
];

function getSavedBackgroundTheme() {
    const saved = String(localStorage.cc_bgTheme || '').trim();
    return BACKGROUND_THEMES.some(t => t.id === saved) ? saved : 'royal-noir';
}

function applyBackgroundTheme(themeId) {
    const next = BACKGROUND_THEMES.some(t => t.id === themeId) ? themeId : 'royal-noir';
    document.body.dataset.bgTheme = next;
    localStorage.cc_bgTheme = next;
    document.querySelectorAll('.bgChoice').forEach(btn => btn.classList.toggle('selected', btn.dataset.bgTheme === next));
}

function refreshBackgroundChooserText() {
    const bgButton = $('backgroundBtn');
    if (bgButton) bgButton.textContent = uiLanguage === 'ar' ? 'الخلفيات' : 'Backgrounds';
    document.querySelectorAll('.bgChoice').forEach(btn => {
        const meta = BACKGROUND_THEMES.find(t => t.id === btn.dataset.bgTheme);
        if (meta) btn.textContent = uiLanguage === 'ar' ? meta.ar : meta.en;
    });
}

const UI_TEXT = {
    en: {
        modes: 'MODES',
        singlePlayer: 'Single Player',
        arabicMode: 'Arabic Mode',
        englishMode: 'English Mode',
        checkingAi: 'Checking AI...',
        starting: 'Starting...',
        name: 'Name',
        roomCode: 'Room Code',
        yourName: 'Your Name',
        avatar: 'Avatar',
        optional: '(optional)',
        uploadImage: 'Upload Image',
        remove: 'Remove',
        chooseTeam: 'Choose your team',
        goldTeam: 'Gold Team',
        blackTeam: 'Black Team',
        goldShort: 'GOLD',
        blackShort: 'BLACK',
        spectator: 'Spectator',
        joinGold: 'Join the golden side',
        joinBlack: 'Join the shadow side',
        watchOnly: 'Watch only',
        createRoom: 'Create Room',
        joinRoom: 'Join Room',
        startGame: 'Start Game',
        options: 'Options ▾',
        resetTable: 'Reset Table',
        shuffleTeams: 'Shuffle Teams',
        changeWordList: 'Change Word List',
        chooseSingle: 'Choose Single Player Mode',
        aiOnlineNote: 'The AI gives clues. This only starts when the host PC AI engine is online.',
        easyMode: 'Easy Mode',
        mediumMode: 'Medium Mode',
        extremeMode: 'Extreme Mode',
        easyDesc: 'Relaxed bot guesses. Better for casual solo practice.',
        mediumDesc: 'Balanced bot guesses with a small chance to miss.',
        extremeDesc: 'Sharp bot guesses that follow the AI clue as tightly as possible.',
        chooseRole: 'Choose your role',
        pickHow: 'Pick how you want to play on this team.',
        operative: 'Operative',
        spymaster: 'Spymaster',
        guessCards: 'Guess cards with your team.',
        guessCardsShort: 'Guess cards',
        giveCluesSee: 'Give clues and see hidden colors.',
        giveCluesShort: 'Give clues',
        watchRoom: 'Watch the room only.',
        hintText: 'Spymasters see hidden colors; operatives only see revealed cards.',
        goldUpper: 'GOLD TEAM',
        blackUpper: 'BLACK TEAM',
        operatives: 'Operatives',
        spymasters: 'Spymasters',
        spectators: 'Spectators',
        gameLog: 'Game Log',
        clueControl: 'Clue Control',
        generateInvite: 'Generate Invite',
        invitePlaceholder: 'Invite link will appear here',
        pass: 'PASS',
        giveClue: 'Give Clue',
        waiting: 'Waiting',
        clueWord: 'Clue word',
        hintPlaceholder: 'Hint',
        number: 'Number',
        currentClue: 'CLUE',
        createNewGame: 'Create New Game',
        back: 'Back',
        confirm: '✓ Confirm',
        round: 'Round',
        game: 'Game',
        teamWon: '{team} WON THE GAME!',
        congratulations: 'Congratulations!',
        adminRequest: 'Admin Request',
        adminRequestText: 'A player requested an admin action.',
        no: 'No',
        yesApply: 'Yes, apply now',
        empty: 'Empty',
        danger: 'Danger',
        turn: '{team} TURN',
        wins: '{team} WINS',
        aiClueFailed: 'AI CLUE FAILED',
        preparingYourClue: 'PREPARING YOUR CLUE',
        preparingBotClue: 'PREPARING BOT CLUE',
        waitingSpy: 'WAITING FOR {team} SPYMASTER TO GIVE A CLUE',
        waitingNamedSpy: 'WAITING FOR {name} TO GIVE A CLUE',
        yourPickTurn: 'YOUR TURN TO PICK THE CARDS',
        botPicking: 'DSTY BOT IS PICKING CARDS',
        waitingOps: 'WAITING FOR {team} TEAM OPERATIVES TO PICK THE CARDS',
        noGuesses: 'No guesses yet',
        players: '{count} player{suffix}',
        noOperatives: 'No operatives yet',
        noSpymaster: 'No spymaster yet',
        noSpectators: 'No spectators',
        hideTeam: 'Hide Team',
        showTeam: 'Show Team',
        writeName: 'Write your name first.',
        characterTaken: 'That character is already taken. Pick another one.',
        characterTakenFirst: 'That character is already taken. Pick another one first.',
        avatarUpdated: 'Avatar updated.',
        avatarRemoved: 'Avatar removed.',
        profileUpdateFailed: 'Could not update your profile.',
        uploadFailed: 'Could not upload avatar.',
        offlineAi: "the host's pc where he hosts the ai engine that runs this mode is turned off at the moment",
        roomPreview: 'Room {room} preview',
        roomPreviewTitle: 'Room preview',
        roomNotFound: 'Room not found yet. Create it or check the code.',
        full: 'Full',
        spymasterFull: 'Spymaster Full'
    },
    ar: {
        modes: 'الأوضاع',
        singlePlayer: 'لاعب واحد',
        arabicMode: 'الوضع العربي',
        englishMode: 'English Mode',
        checkingAi: 'جار فحص الذكاء...',
        starting: 'جار البدء...',
        name: 'الاسم',
        roomCode: 'رمز الغرفة',
        yourName: 'اسمك',
        avatar: 'الصورة',
        optional: '(اختياري)',
        uploadImage: 'رفع صورة',
        remove: 'إزالة',
        chooseTeam: 'اختر فريقك',
        goldTeam: 'الفريق الذهبي',
        blackTeam: 'الفريق الأسود',
        goldShort: 'ذهبي',
        blackShort: 'أسود',
        spectator: 'مشاهد',
        joinGold: 'انضم للجهة الذهبية',
        joinBlack: 'انضم للجهة السوداء',
        watchOnly: 'مشاهدة فقط',
        createRoom: 'إنشاء غرفة',
        joinRoom: 'دخول الغرفة',
        startGame: 'ابدأ اللعبة',
        options: 'الخيارات ▾',
        resetTable: 'إعادة الطاولة',
        shuffleTeams: 'خلط الفرق',
        changeWordList: 'تغيير الكلمات',
        chooseSingle: 'اختر وضع اللاعب الواحد',
        aiOnlineNote: 'الذكاء يعطي التلميحات. يبدأ فقط إذا كان محرك الذكاء على جهاز المضيف يعمل.',
        easyMode: 'وضع سهل',
        mediumMode: 'وضع متوسط',
        extremeMode: 'وضع صعب',
        easyDesc: 'تخمينات أسهل للتدريب الهادئ.',
        mediumDesc: 'تخمينات متوازنة مع احتمال بسيط للخطأ.',
        extremeDesc: 'تخمينات دقيقة تتبع تلميح الذكاء بقوة.',
        chooseRole: 'اختر دورك',
        pickHow: 'اختر كيف تريد اللعب في هذا الفريق.',
        operative: 'لاعب تخمين',
        spymaster: 'صاحب التلميح',
        guessCards: 'خمن البطاقات مع فريقك.',
        guessCardsShort: 'تخمين البطاقات',
        giveCluesSee: 'أعط التلميحات وشاهد الألوان المخفية.',
        giveCluesShort: 'إعطاء التلميحات',
        watchRoom: 'شاهد الغرفة فقط.',
        hintText: 'صاحب التلميح يرى الألوان المخفية؛ لاعبو التخمين يرون البطاقات المكشوفة فقط.',
        goldUpper: 'الفريق الذهبي',
        blackUpper: 'الفريق الأسود',
        operatives: 'لاعبو التخمين',
        spymasters: 'أصحاب التلميح',
        spectators: 'المشاهدون',
        gameLog: 'سجل اللعبة',
        clueControl: 'التحكم بالتلميح',
        generateInvite: 'إنشاء دعوة',
        invitePlaceholder: 'سيظهر رابط الدعوة هنا',
        pass: 'تمرير',
        giveClue: 'إعطاء التلميح',
        waiting: 'انتظار',
        clueWord: 'كلمة التلميح',
        hintPlaceholder: 'تلميح',
        number: 'العدد',
        currentClue: 'التلميح',
        createNewGame: 'لعبة جديدة',
        back: 'رجوع',
        confirm: '✓ تأكيد',
        round: 'الجولة',
        game: 'اللعبة',
        teamWon: 'فاز {team}!',
        congratulations: 'مبروك!',
        adminRequest: 'طلب إداري',
        adminRequestText: 'طلب أحد اللاعبين إجراء إداريا.',
        no: 'لا',
        yesApply: 'نعم، طبق الآن',
        empty: 'فارغ',
        danger: 'خطر',
        turn: 'دور {team}',
        wins: 'فاز {team}',
        aiClueFailed: 'فشل تلميح الذكاء',
        preparingYourClue: 'يتم تحضير تلميحك',
        preparingBotClue: 'يتم تحضير تلميح البوت',
        waitingSpy: 'بانتظار صاحب تلميح {team}',
        waitingNamedSpy: 'بانتظار {name} لإعطاء التلميح',
        yourPickTurn: 'دورك لاختيار البطاقات',
        botPicking: 'بوت DSTY يختار البطاقات',
        waitingOps: 'بانتظار لاعبي {team} لاختيار البطاقات',
        noGuesses: 'لا توجد تخمينات بعد',
        players: '{count} لاعب',
        noOperatives: 'لا يوجد لاعبون بعد',
        noSpymaster: 'لا يوجد صاحب تلميح بعد',
        noSpectators: 'لا يوجد مشاهدون',
        hideTeam: 'إخفاء الفريق',
        showTeam: 'إظهار الفريق',
        writeName: 'اكتب اسمك أولا.',
        characterTaken: 'هذه الشخصية مستخدمة. اختر شخصية أخرى.',
        characterTakenFirst: 'هذه الشخصية مستخدمة. اختر شخصية أخرى أولا.',
        avatarUpdated: 'تم تحديث الصورة.',
        avatarRemoved: 'تمت إزالة الصورة.',
        profileUpdateFailed: 'تعذر تحديث ملفك.',
        uploadFailed: 'تعذر رفع الصورة.',
        offlineAi: 'جهاز المضيف الذي يشغل محرك الذكاء لهذا الوضع مغلق حاليا',
        roomPreview: 'معاينة الغرفة {room}',
        roomPreviewTitle: 'معاينة الغرفة',
        roomNotFound: 'الغرفة غير موجودة بعد. أنشئها أو تحقق من الرمز.',
        full: 'ممتلئ',
        spymasterFull: 'المكان ممتلئ'
    }
};

function tt(key, vars = {}) {
    const text = (UI_TEXT[uiLanguage] && UI_TEXT[uiLanguage][key]) || UI_TEXT.en[key] || key;
    return String(text).replace(/\{(\w+)}/g, (_, name) => vars[name] ?? '');
}

function setText(selector, key, vars = {}) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (el) el.textContent = tt(key, vars);
}

function setButtonText(id, key) {
    const el = $(id);
    if (el) el.textContent = tt(key);
}

function setLabelText(selector, key) {
    const label = document.querySelector(selector);
    if (!label) return;
    const node = [...label.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (node) node.textContent = `${tt(key)} `;
}

function setPlaceholder(id, key) {
    const el = $(id);
    if (el) el.placeholder = tt(key);
}

function applyLanguage() {
    localStorage.cc_language = uiLanguage;
    document.documentElement.lang = uiLanguage === 'ar' ? 'ar' : 'en';
    document.documentElement.dir = uiLanguage === 'ar' ? 'rtl' : 'ltr';
    document.body.dataset.lang = uiLanguage;
    const modesButton = $('modesBtn');
    if (modesButton) modesButton.textContent = 'Modes / الأوضاع';
    const singleModeButton = $('singlePlayerBtn');
    if (singleModeButton) singleModeButton.textContent = 'Single Player / لاعب فردي';
    const languageModeButton = $('arabicModeBtn');
    if (languageModeButton) languageModeButton.textContent = uiLanguage === 'ar' ? 'English Mode' : 'Arabic Mode / الوضع العربي';
    $('singlePlayerBtn')?.classList.add('primaryMode');
    refreshBackgroundChooserText();
    applyBackgroundTheme(getSavedBackgroundTheme());
    setLabelText('.joinBasics label:first-child', 'name');
    setLabelText('.websiteRoomField', 'roomCode');
    setPlaceholder('name', 'yourName');
    setLabelText('.avatarUploadLabel', 'avatar');
    setText('.avatarUploadLabel small', 'optional');
    setButtonText('avatarUploadBtn', 'uploadImage');
    setButtonText('avatarClearBtn', 'remove');
    setText('.teamChooseTitle', 'chooseTeam');
    const teamButtons = document.querySelectorAll('.teamPick');
    if (teamButtons[0]) {
        teamButtons[0].querySelector('span').textContent = tt('goldTeam');
        teamButtons[0].querySelector('small').textContent = tt('joinGold');
    }
    if (teamButtons[1]) {
        teamButtons[1].querySelector('span').textContent = tt('blackTeam');
        teamButtons[1].querySelector('small').textContent = tt('joinBlack');
    }
    if (teamButtons[2]) {
        teamButtons[2].querySelector('span').textContent = tt('spectator');
        teamButtons[2].querySelector('small').textContent = tt('watchOnly');
    }
    const discordCards = document.querySelectorAll('.discordRoleGrid > section');
    if (discordCards[0]) {
        discordCards[0].querySelector('h2').textContent = tt('goldTeam');
        const boxes = discordCards[0].querySelectorAll('.discordRoleBox');
        if (boxes[0]) {
            boxes[0].querySelector('b').textContent = tt('operatives');
            boxes[0].querySelector('small').textContent = tt('guessCardsShort');
        }
        if (boxes[1]) {
            boxes[1].querySelector('b').textContent = tt('spymasters');
            boxes[1].querySelector('small').textContent = tt('giveCluesShort');
        }
    }
    if (discordCards[1]) {
        discordCards[1].querySelector('h2').textContent = uiLanguage === 'ar' ? 'المشاهدون 👁' : 'Spectators 👁';
        const p = discordCards[1].querySelector('p:not(.discordHelpText)');
        if (p) p.textContent = uiLanguage === 'ar' ? 'شاهد المباراة بدون تخمين.' : 'Watch the match without guessing.';
        const help = discordCards[1].querySelector('.discordHelpText');
        if (help) help.textContent = uiLanguage === 'ar' ? 'اختر أي جهة ودور، ثم تفتح غرفة Discord Activity تلقائيا.' : 'Choose any side and role, then your Discord Activity room opens automatically.';
    }
    if (discordCards[2]) {
        discordCards[2].querySelector('h2').textContent = tt('blackTeam');
        const boxes = discordCards[2].querySelectorAll('.discordRoleBox');
        if (boxes[0]) {
            boxes[0].querySelector('b').textContent = tt('operatives');
            boxes[0].querySelector('small').textContent = tt('guessCardsShort');
        }
        if (boxes[1]) {
            boxes[1].querySelector('b').textContent = tt('spymasters');
            boxes[1].querySelector('small').textContent = tt('giveCluesShort');
        }
    }
    document.querySelectorAll('.discordRoleJoin').forEach(btn => {
        const role = btn.dataset.role;
        btn.textContent = role === 'spectator'
            ? (uiLanguage === 'ar' ? 'الدخول كمشاهد' : 'Join as Spectator')
            : (uiLanguage === 'ar' ? 'دخول' : 'Join');
    });
    setButtonText('createBtn', 'createRoom');
    setButtonText('joinBtn', 'joinRoom');
    setButtonText('landingStartGameBtn', 'startGame');
    document.querySelectorAll('.optionsBtn').forEach(btn => btn.textContent = tt('options'));
    setButtonText('landingResetTableBtn', 'resetTable');
    setButtonText('landingShuffleTeamsBtn', 'shuffleTeams');
    setButtonText('resetTableBtn', 'resetTable');
    setButtonText('shuffleTeamsBtn', 'shuffleTeams');
    setText('#singleDifficultyOverlay h2', 'chooseSingle');
    setText('#singleDifficultyOverlay p', 'aiOnlineNote');
    const difficulty = document.querySelectorAll('[data-single-difficulty]');
    [['easyMode', 'easyDesc'], ['mediumMode', 'mediumDesc'], ['extremeMode', 'extremeDesc']].forEach(([title, desc], i) => {
        if (!difficulty[i]) return;
        difficulty[i].querySelector('b').textContent = tt(title);
        difficulty[i].querySelector('span').textContent = tt(desc);
    });
    setText('#rolePopupTitle', 'chooseRole');
    setText('#rolePopupText', 'pickHow');
    const roles = document.querySelectorAll('.rolePick');
    [['operative', 'guessCards'], ['spymaster', 'giveCluesSee'], ['spectator', 'watchRoom']].forEach(([title, desc], i) => {
        if (!roles[i]) return;
        roles[i].querySelector('b').textContent = tt(title);
        roles[i].querySelector('span').textContent = tt(desc);
    });
    setText('#landing > .hintText', 'hintText');
    setButtonText('newRoundBtn', 'createNewGame');
    setButtonText('backToLobbyBtn', 'back');
    setButtonText('confirmVoteBtn', 'confirm');
    setText('#goldPanel .teamHeader b', 'goldUpper');
    setText('#blackPanel .teamHeader b', 'blackUpper');
    setText('#goldScoreBadge b', 'goldShort');
    setText('#blackScoreBadge b', 'blackShort');
    const goldSections = document.querySelectorAll('#goldPanel section h3');
    const blackSections = document.querySelectorAll('#blackPanel section h3');
    if (goldSections[0]) goldSections[0].textContent = tt('operatives');
    if (goldSections[1]) goldSections[1].textContent = tt('spymasters');
    if (blackSections[0]) blackSections[0].textContent = tt('operatives');
    if (blackSections[1]) blackSections[1].textContent = tt('spymasters');
    if (blackSections[2]) blackSections[2].textContent = tt('spectators');
    if (blackSections[3]) blackSections[3].textContent = tt('gameLog');
    setText('.clueBoxSide h3', 'clueControl');
    setButtonText('inviteBtn', 'generateInvite');
    setPlaceholder('inviteLinkGame', 'invitePlaceholder');
    setButtonText('endTurnBtn', 'pass');
    setText('#dockTitle', 'giveClue');
    setLabelText('#bottomClueDock label:first-of-type', 'clueWord');
    setLabelText('#bottomClueDock .numberLabel', 'number');
    setPlaceholder('clueWord', 'hintPlaceholder');
    setButtonText('giveClueBtn', 'giveClue');
    const timerSpans = document.querySelectorAll('.timers span');
    if (timerSpans[0]?.firstChild) timerSpans[0].firstChild.textContent = `${tt('round')} `;
    if (timerSpans[1]?.firstChild) timerSpans[1].firstChild.textContent = `${tt('game')} `;
    setText('#adminRequestModal h2', 'adminRequest');
    setText('#adminRequestText', 'adminRequestText');
    setButtonText('adminRequestNo', 'no');
    setButtonText('adminRequestYes', 'yesApply');
    setText('.characterTitle', uiLanguage === 'ar' ? 'اختر شخصيتك' : 'Choose your character');
    if (typeof setJoinButtonsReady === 'function') setJoinButtonsReady();
    if (state) render();
    if (socket?.connected) socket.emit('setLanguage', {language: uiLanguage});
    if (document.body.classList.contains('discordActivity')) refreshDiscordLobbyPreview(true);
}

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


function previewRolePlayersHtml(res, team, role) {
    const players = res?.roles?.[team]?.[role] || [];
    if (!players.length) return `<span class="previewEmpty">${uiLanguage === 'ar' ? 'فارغ' : 'Empty'}</span>`;
    return players.map(p => `<span class="previewSeat">${avatarHtml(p, 'lobbyAvatar')}<em>${escapeHtml(p.name || (uiLanguage === 'ar' ? 'لاعب' : 'Player'))}</em></span>`).join('');
}

function renderHomepageLobbyPreview(res, allowHidden = false) {
    const box = $('lobbyPreview');
    if (!box) return;
    if (!res?.ok) {
        if (allowHidden) box.classList.add('hidden');
        return;
    }
    if (isDiscordActivity) {
        // Discord lobby uses the role cards themselves; paintDiscordLobby renders the seats there.
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    const shouldShow = selectedTeamChoice || selectedRoleChoice || !isDiscordActivity;
    if (!shouldShow && allowHidden) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    const gs = (res.spymasters?.blue || []).join(', ') || (uiLanguage === 'ar' ? 'لا يوجد صاحب تلميح ذهبي متصل' : 'No Gold spymaster online');
    const bs = (res.spymasters?.red || []).join(', ') || (uiLanguage === 'ar' ? 'لا يوجد صاحب تلميح أسود متصل' : 'No Black spymaster online');
    box.classList.remove('hidden');
    box.innerHTML = `<b>${tt('roomPreview', {room: res.roomId})}</b>
        <div class="previewGrid"><span>${tt('goldTeam')}: <strong>${res.counts.blue}</strong></span><span>${tt('blackTeam')}: <strong>${res.counts.red}</strong></span><span>${tt('spectators')}: <strong>${res.counts.spectator}</strong></span><span>${uiLanguage === 'ar' ? 'المجموع' : 'Total'}: <strong>${res.playersTotal}</strong></span></div>
        <div class="previewSpies"><span>${tt('goldTeam')} ${tt('spymaster')}: <strong>${gs}</strong></span><span>${tt('blackTeam')} ${tt('spymaster')}: <strong>${bs}</strong></span></div>
        <div class="previewRoster">
            <section class="previewTeam previewGold"><h4>${tt('goldTeam')} ${tt('operatives')}</h4><div>${previewRolePlayersHtml(res, 'blue', 'operative')}</div></section>
            <section class="previewTeam previewGold"><h4>${tt('goldTeam')} ${tt('spymasters')}</h4><div>${previewRolePlayersHtml(res, 'blue', 'spymaster')}</div></section>
            <section class="previewTeam previewBlack"><h4>${tt('blackTeam')} ${tt('operatives')}</h4><div>${previewRolePlayersHtml(res, 'red', 'operative')}</div></section>
            <section class="previewTeam previewBlack"><h4>${tt('blackTeam')} ${tt('spymasters')}</h4><div>${previewRolePlayersHtml(res, 'red', 'spymaster')}</div></section>
            <section class="previewTeam previewSpectators"><h4>${tt('spectators')}</h4><div>${previewRolePlayersHtml(res, 'spectator', 'spectator')}</div></section>
        </div>`;
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
                box.innerHTML = `<b>${tt('roomPreviewTitle')}</b><span class="muted">${tt('roomNotFound')}</span>`;
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
        renderHomepageLobbyPreview(res, true);
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

function showGameIntro(reason = 'join') {
    const overlay = $('gameIntroOverlay');
    if (!overlay || !state?.id) return;
    const key = `${state.id}:${state.round}:${state.status}:${reason}`;
    if (lastIntroKey === key) return;
    lastIntroKey = key;
    if (gameIntroTimer) clearTimeout(gameIntroTimer);
    overlay.classList.remove('hidden', 'introOut');
    overlay.setAttribute('aria-hidden', 'false');
    void overlay.offsetWidth;
    overlay.classList.add('introLive');
    gameIntroTimer = setTimeout(() => {
        overlay.classList.add('introOut');
        gameIntroTimer = setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('introLive', 'introOut');
            overlay.setAttribute('aria-hidden', 'true');
        }, 420);
    }, 2450);
}

function revealReactionForCard(card, beforeState, nowState) {
    if (!card?.revealed) return null;
    const revealer = card.revealedById ? nowState?.players?.[card.revealedById] : null;
    const pickerTeam = revealer?.team || beforeState?.turn || '';
    if (card.color === 'assassin') {
        return {kind: 'death', img: '/death.png', text: 'BOOM! Death card!'};
    }
    if (card.color === 'neutral') {
        return {kind: 'grey', img: '/grey.png', text: 'Grey zone! Turn over!'};
    }
    if (pickerTeam && card.color === pickerTeam) {
        return {kind: 'correct', img: '/correct.png', text: 'YAAAY! Nice pick!'};
    }
    return {kind: 'wrong', img: '/wrong.png', text: 'Oops! Wrong team!'};
}

function firstRevealReaction(beforeState, nowState) {
    if (!beforeState?.board || !nowState?.board) return null;
    for (const card of nowState.board) {
        const old = beforeState.board.find(x => x.id === card.id);
        if (old && !old.revealed && card.revealed) return revealReactionForCard(card, beforeState, nowState);
    }
    return null;
}



function revealLiftSelector(id) {
    return `.card[data-id="${String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function removeRevealLiftGhost(id) {
    const ghost = revealLiftGhosts.get(id);
    if (!ghost) return;
    revealLiftGhosts.delete(id);
    ghost.classList.add('cardRevealLiftGhostDone');
    setTimeout(() => ghost.remove(), 180);
}

function clearRevealLiftGhosts() {
    revealLiftGhosts.forEach(ghost => ghost.remove());
    revealLiftGhosts.clear();
}

function startRevealLiftGhost(card) {
    if (!card || !board || !document.body) return;
    removeRevealLiftGhost(card.id);
    const src = board.querySelector(revealLiftSelector(card.id));
    if (!src) return;
    const rect = src.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Build a fresh full-card overlay instead of cloning only the inner word area.
    // The overlay is fixed exactly over the picked grey card, then only scales from its center.
    const ghost = document.createElement('div');
    const crown = document.createElement('img');
    const word = document.createElement('span');
    const wordText = String(card.word || '').trim();
    const revealGhostColor = String(card.color || '').replace(/[^a-z0-9_-]/gi, '');
    ghost.className = `cardRevealLiftGhost cardRevealFullGhost operativeRevealGhost ${revealGhostColor ? `revealGhost-${revealGhostColor}` : ''}`;
    crown.className = 'cardCrownLayer cardRevealGhostCrown';
    crown.src = '/crown-bw.png';
    crown.alt = '';
    crown.setAttribute('aria-hidden', 'true');
    word.className = `word ${cardLengthClass(wordText)}`;
    word.style.setProperty('--letters', String(wordText.length || 1));
    word.textContent = wordText;
    ghost.appendChild(crown);
    ghost.appendChild(word);

    const srcStyle = window.getComputedStyle(src);
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.borderRadius = srcStyle.borderRadius;
    ghost.style.padding = srcStyle.padding || '12px';
    ghost.style.boxSizing = 'border-box';
    ghost.style.transformOrigin = '50% 50%';
    ghost.style.setProperty('--reveal-ms', `${REVEAL_ASCEND_MS}ms`);
    ghost.setAttribute('aria-hidden', 'true');

    revealLiftGhosts.set(card.id, ghost);
    document.body.appendChild(ghost);
}

function revealTokenForState(nowState, card) {
    return `${nowState?.id || ''}:${nowState?.round ?? 0}:${card?.id ?? ''}`;
}

function clearDelayedReveals() {
    if (delayedWinRevealTimer) {
        clearTimeout(delayedWinRevealTimer);
        delayedWinRevealTimer = null;
    }
    winRevealHoldUntil = 0;
    delayedRevealTimers.forEach(timer => clearTimeout(timer));
    delayedRevealTimers.clear();
    delayedRevealTokens.clear();
    delayedRevealReactions.clear();
    pendingRevealIds.clear();
    clearRevealLiftGhosts();
}

function newlyRevealedCards(beforeState, nowState) {
    if (!beforeState?.board || !nowState?.board) return [];
    const oldById = new Map(beforeState.board.map(card => [card.id, card]));
    return nowState.board
        .filter(card => {
            const old = oldById.get(card.id);
            return old && !old.revealed && card.revealed;
        });
}

function playRevealSoundForCard(card) {
    if (!card) return;
    const p = me();
    if (card.color === 'assassin') return sound('assassin');
    if (card.color === 'neutral') return sound('neutral');
    if (p && p.team !== 'spectator') return sound(card.color === p.team ? 'correct' : 'wrong');
    return sound(card.color === 'blue' || card.color === 'red' ? 'correct' : 'neutral');
}

function playGameWinSoundOnce() {
    if (!(state?.status === 'finished' && state?.winner)) {
        lastGameWinSoundKey = null;
        return;
    }
    const key = `${state.id || ''}-${state.round || 0}-${state.winner}-gameWinSound`;
    if (lastGameWinSoundKey === key) return;
    lastGameWinSoundKey = key;
    sound('gameWin');
}

function finishDelayedReveal(id, token) {
    if (delayedRevealTokens.get(id) !== token) return;
    const reaction = delayedRevealReactions.get(id);
    delayedRevealTimers.delete(id);
    delayedRevealTokens.delete(id);
    delayedRevealReactions.delete(id);
    pendingRevealIds.delete(id);
    removeRevealLiftGhost(id);

    const card = state?.board?.find(c => c.id === id);
    const stillSameRound = token === revealTokenForState(state, card);
    if (!card || !card.revealed || !stillSameRound) return;

    renderBoard();
    renderLog();
    playRevealSoundForCard(card);
    if (card.color === 'blue' || card.color === 'red') {
        requestAnimationFrame(() => flyCardToTeamScore(card));
    }
    showPickReaction(reaction);
    if (pendingRevealIds.size === 0 && state?.status === 'finished' && state?.winner) {
        if (delayedWinRevealTimer) clearTimeout(delayedWinRevealTimer);
        // Final win effects must wait until the picked card has finished its reveal and the reaction image has appeared.
        // Death/assassin needs a longer pause so the death PNG is seen first, then the winner popup appears.
        const delay = reaction ? (reaction.kind === 'death' ? 3600 : 2300) : 1400;
        winRevealHoldUntil = Date.now() + delay;
        hideWinEffectsForCurrentView();
        delayedWinRevealTimer = setTimeout(() => {
            delayedWinRevealTimer = null;
            winRevealHoldUntil = 0;
            if (pendingRevealIds.size === 0 && state?.status === 'finished' && state?.winner) {
                playGameWinSoundOnce();
                render();
            }
        }, delay);
    }
}

function scheduleDelayedReveals(beforeState, nowState) {
    const reveals = newlyRevealedCards(beforeState, nowState);
    if (!reveals.length) return [];

    for (const card of reveals) {
        const id = card.id;
        const token = revealTokenForState(nowState, card);
        const existing = delayedRevealTimers.get(id);
        if (existing) clearTimeout(existing);

        pendingRevealIds.add(id);
        delayedRevealTokens.set(id, token);
        delayedRevealReactions.set(id, revealReactionForCard(card, beforeState, nowState));
        startRevealLiftGhost(card);
        delayedRevealTimers.set(id, setTimeout(() => finishDelayedReveal(id, token), REVEAL_ASCEND_MS));
    }

    return reveals;
}

function showPickReaction(reaction) {
    if (!reaction) return;
    const overlay = $('pickReactionOverlay');
    const card = $('pickReactionCard');
    const img = $('pickReactionImg');
    const text = $('pickReactionText');
    if (!overlay || !card || !img || !text) return;
    if (reactionTimer) clearTimeout(reactionTimer);
    img.src = reaction.img;
    text.textContent = reaction.text;
    card.className = `pickReactionCard ${reaction.kind || 'correct'}`;
    overlay.classList.remove('hidden', 'reactionOut');
    overlay.setAttribute('aria-hidden', 'false');
    void overlay.offsetWidth;
    overlay.classList.add('reactionLive');
    reactionTimer = setTimeout(() => {
        overlay.classList.add('reactionOut');
        reactionTimer = setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('reactionLive', 'reactionOut');
            overlay.setAttribute('aria-hidden', 'true');
        }, 320);
    }, 1750);
}


function spymasterClueSplashImageCandidates(team) {
    const file = team === 'red' ? 'blackspymaster.png' : 'goldspymaster.png';
    const basePath = window.location.pathname.replace(/[^/]*$/, '');
    const rawCandidates = [
        `/${file}`,                         // Express serves files inside /public from the site root.
        `${basePath}${file}`,
        `./${file}`,
        file,
        `${basePath}public/${file}`,        // Works if testing from the project root instead of Express.
        `./public/${file}`,
        `/public/${file}`
    ];
    return [...new Set(rawCandidates)].map(src => `${src}${src.includes('?') ? '&' : '?'}v=137`);
}

function setSpymasterClueSplashImage(img, team) {
    if (!img) return;
    const candidates = spymasterClueSplashImageCandidates(team);
    img.dataset.spyTeam = team;
    img.dataset.srcIndex = '0';
    img.classList.remove('spymasterImageMissing');
    img.style.opacity = '1';
    img.style.visibility = 'visible';

    img.onerror = () => {
        const list = spymasterClueSplashImageCandidates(img.dataset.spyTeam === 'red' ? 'red' : 'blue');
        const nextIndex = (parseInt(img.dataset.srcIndex || '0', 10) || 0) + 1;
        if (nextIndex >= list.length) {
            img.onerror = null;
            img.classList.add('spymasterImageMissing');
            return;
        }
        img.dataset.srcIndex = String(nextIndex);
        img.src = list[nextIndex];
    };
    img.onload = () => {
        img.classList.remove('spymasterImageMissing');
        img.style.opacity = '1';
        img.style.visibility = 'visible';
    };
    img.src = candidates[0];
}

function spymasterClueSplashAlt(team) {
    if (uiLanguage === 'ar') return team === 'red' ? 'صاحب تلميح الفريق الأسود' : 'صاحب تلميح الفريق الذهبي';
    return team === 'red' ? 'Black spymaster' : 'Gold spymaster';
}

function formatSplashClueWord(word) {
    const value = String(word || '').trim();
    return uiLanguage === 'ar' ? value : value.toUpperCase();
}

function ensureSpymasterClueSplash() {
    let overlay = $('spymasterClueSplash');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'spymasterClueSplash';
    overlay.className = 'spymasterClueSplash hidden';
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <div class="spymasterClueStage" role="presentation">
            <img id="spymasterClueImg" class="spymasterClueImg" src="" alt="" draggable="false">
            <div class="spymasterClueBox">
                <span class="spymasterClueLabel"></span>
                <b id="spymasterClueWord"></b>
                <strong class="spymasterClueNumber"><span id="spymasterClueNumber"></span><em id="spymasterClueCardsLabel"></em></strong>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    return overlay;
}

function hideSpymasterClueSplash(overlay) {
    if (!overlay) return;
    overlay.classList.add('clueSplashOut');
    clueSplashTimer = setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('clueSplashLive', 'clueSplashOut', 'blue', 'red');
        overlay.setAttribute('aria-hidden', 'true');
    }, 420);
}

function showSpymasterClueSplash(clue) {
    if (!clue || !clue.word) return;
    const team = clue.team === 'red' ? 'red' : 'blue';
    const key = `${state?.id || ''}:${state?.round || 0}:${team}:${clue.at || ''}:${clue.word}:${clue.number}`;
    if (lastClueSplashKey === key) return;
    lastClueSplashKey = key;

    const overlay = ensureSpymasterClueSplash();
    const img = $('spymasterClueImg');
    const label = overlay.querySelector('.spymasterClueLabel');
    const word = $('spymasterClueWord');
    const number = $('spymasterClueNumber');
    const cardsLabel = $('spymasterClueCardsLabel');
    if (!img || !label || !word || !number || !cardsLabel) return;

    if (clueSplashTimer) clearTimeout(clueSplashTimer);
    setSpymasterClueSplashImage(img, team);
    img.alt = spymasterClueSplashAlt(team);
    label.textContent = tt('currentClue');
    word.textContent = formatSplashClueWord(clue.word);
    number.textContent = String(Number(clue.number || 0));
    cardsLabel.textContent = uiLanguage === 'ar' ? 'بطاقات' : 'CARDS';

    overlay.classList.remove('hidden', 'clueSplashLive', 'clueSplashOut', 'blue', 'red');
    overlay.classList.add(team);
    overlay.setAttribute('aria-hidden', 'false');
    void overlay.offsetWidth;
    overlay.classList.add('clueSplashLive');

    clueSplashTimer = setTimeout(() => hideSpymasterClueSplash(overlay), 2700);
}

function toast(msg, variant = '') {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hostOnlyModeToast');
    if (variant) t.classList.add(variant);
    t.classList.add('show');
    setTimeout(() => {
        t.classList.remove('show');
        if (variant) t.classList.remove(variant);
    }, String(msg || '').length > 70 ? 5200 : 2600);
}

function activeModeRoomCode() {
    const codeValue = state?.id || roomInput?.value || (isDiscordActivity ? getDiscordActivityRoomCode() : '');
    return String(codeValue || '').trim().toUpperCase();
}

function showHostOnlyModeWarning() {
    const msg = uiLanguage === 'ar'
        ? 'فقط مضيف الغرفة يمكنه تغيير الوضع أو اللغة لهذه اللعبة.'
        : 'Only the room host can change the mode or language for this game.';
    toast(msg, 'hostOnlyModeToast');
    modesMenu?.classList.add('hidden');
}

function hasModeHostAccess(roomCode = activeModeRoomCode()) {
    const p = me();
    if (p?.isAdmin) return true;
    return !!(roomCode && getAdminToken(roomCode));
}

function withModeHostAccess(action) {
    const roomCode = activeModeRoomCode();
    if (!roomCode || hasModeHostAccess(roomCode)) return action();

    if (state?.id) {
        showHostOnlyModeWarning();
        return;
    }

    const knownPreviewRoom = !!(lastLobbyInfo?.ok && String(lastLobbyInfo.roomId || '').toUpperCase() === roomCode);
    if (knownPreviewRoom) {
        showHostOnlyModeWarning();
        return;
    }

    socket.emit('getRoomInfo', {roomId: roomCode}, res => {
        if (res?.ok) {
            applyLobbyInfo(res);
            if (!hasModeHostAccess(roomCode)) {
                showHostOnlyModeWarning();
                return;
            }
        }
        action();
    });
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
    return team === 'blue' ? tt('goldTeam') : team === 'red' ? tt('blackTeam') : team === 'neutral' ? tt('empty') : team === 'assassin' ? tt('danger') : tt('spectator');
}

function teamUpper(team) {
    return uiLanguage === 'ar' ? teamName(team) : teamName(team).toUpperCase();
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
            if (state.aiClueStatus?.state === 'failed' && state.aiClueStatus?.team === state.turn) {
                return tt('aiClueFailed');
            }
            return state.turn === 'blue' ? tt('preparingYourClue') : tt('preparingBotClue');
        }
        const spy = spymasterForTeam(state.turn);
        if (!spy) return tt('waitingSpy', {team: teamUpper(state.turn)});
        const src = safeAvatarSrc(playerAvatar(spy));
        const face = src
            ? `<span class="turnStatusAvatar"><img src="${src}" alt="${escapeHtml(spy.name || 'spymaster')}"></span>`
            : `<span class="turnStatusAvatar fallback">${charEmoji(spy.character)}</span>`;
        return uiLanguage === 'ar'
            ? `بانتظار ${face}<strong>${escapeHtml(spy.name || tt('spymaster'))}</strong> لإعطاء التلميح`
            : `WAITING FOR ${face}<strong>${escapeHtml(spy.name || 'SPYMASTER')}</strong> TO GIVE A CLUE`;
    }
    if (state.status === 'guessing') {
        if (state.singlePlayer) {
            return state.turn === 'blue' ? tt('yourPickTurn') : tt('botPicking');
        }
        return tt('waitingOps', {team: teamUpper(state.turn)});
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

const ACTIVITY_SEAT_STORAGE_KEY = 'cc_discordActivitySeat_v2';
const ACTIVITY_SEAT_MAX_AGE_MS = 1000 * 60 * 60 * 12;

function discordScopeKey() {
    const d = window.DD_DISCORD || {};
    return [d.guildId || '', d.channelId || ''].filter(Boolean).join(':') || 'activity';
}

function readSavedDiscordActivitySeat() {
    try {
        const raw = localStorage.getItem(ACTIVITY_SEAT_STORAGE_KEY);
        if (!raw) return null;
        const seat = JSON.parse(raw);
        if (!seat || typeof seat !== 'object') return null;
        const savedAt = Number(seat.savedAt || 0);
        if (!savedAt || Date.now() - savedAt > ACTIVITY_SEAT_MAX_AGE_MS) return null;
        return seat;
    } catch {
        return null;
    }
}

function saveDiscordActivitySeat(extra = {}) {
    if (!isDiscordActivity) return;
    const roomId = String(extra.roomId || roomInput?.value || discordActivityRoomCode || getDiscordActivityRoomCode?.() || '').trim().toUpperCase();
    const team = String(extra.team || $('team')?.value || selectedTeamChoice || '').trim();
    const role = String(extra.role || $('role')?.value || selectedRoleChoice || '').trim();
    if (!roomId || !team || !role) return;
    const seat = {
        roomId,
        team,
        role,
        playerKey: String(extra.playerKey || playerKey || '').trim(),
        character: String(extra.character || outboundCharacter?.() || selectedCharacter || '').trim(),
        name: currentDisplayName?.() || nameInput?.value?.trim() || 'Agent',
        scopeKey: discordScopeKey(),
        adminToken: getAdminToken(roomId),
        savedAt: Date.now()
    };
    try {
        localStorage.setItem(ACTIVITY_SEAT_STORAGE_KEY, JSON.stringify(seat));
    } catch {
    }
}

function clearSavedDiscordActivitySeat() {
    try {
        localStorage.removeItem(ACTIVITY_SEAT_STORAGE_KEY);
    } catch {
    }
}

function stableDiscordFallbackKey(roomCode = '') {
    const room = String(roomCode || getDiscordActivityRoomCode?.() || 'room').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'room';
    const storageKey = `cc_activitySeatSeed_${room}`;
    const base = (() => {
        try {
            let seed = localStorage.getItem(storageKey) || localStorage.getItem('cc_activitySeatSeed') || '';
            if (!seed) seed = sessionStorage.getItem('cc_activityTabSeatSeed') || '';
            if (!seed) seed = makePlayerKey();
            localStorage.setItem(storageKey, seed);
            localStorage.setItem('cc_activitySeatSeed', seed);
            sessionStorage.setItem('cc_activityTabSeatSeed', seed);
            return seed;
        } catch {
            return playerKey || makePlayerKey();
        }
    })();
    const safe = String(base).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'local';
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
            toast(tt('avatarUpdated'));
        } catch (err) {
            toast(err?.message || tt('uploadFailed'));
        } finally {
            avatarFileInput.value = '';
        }
    };
    if (avatarClearBtn) avatarClearBtn.onclick = () => {
        setCustomAvatar('');
        toast(tt('avatarRemoved'));
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
    <div class="characterTitle">${uiLanguage === 'ar' ? 'اختر شخصيتك' : 'Choose your character'}</div>
    <div class="characterGrid">${list.map(c => {
        const disabled = !usingCustom && taken.has(c.id);
        const selected = !usingCustom && c.id === selectedCharacter;
        return `<button type="button" class="char ${selected ? 'selected' : ''} ${disabled ? 'taken' : ''}" data-char="${c.id}" title="${disabled ? c.name + ' is already taken' : c.name}" style="--a:${c.accent}" ${disabled ? 'disabled' : ''}><span>${c.emoji}</span><small>${c.name}</small></button>`;
    }).join('')}</div>`;
    box.querySelectorAll('.char').forEach(el => {
        el.onclick = () => {
            if (el.disabled || el.classList.contains('taken')) {
                toast(tt('characterTaken'));
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
                        toast(res.error || tt('characterTaken'));
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
    return lobbyRolePlayers(team, 'spymaster').some(p => p && !p.isPreview);
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
            b.textContent = fullSpy ? tt('full') : (role === 'spectator' ? (uiLanguage === 'ar' ? 'الدخول كمشاهد' : 'Join as Spectator') : (uiLanguage === 'ar' ? 'دخول' : 'Join'));
        });
        return;
    }
    if (cb) cb.disabled = !ready;
    if (jb) {
        jb.disabled = !ready || selectedSpyFull || !roomInput.value.trim();
        jb.textContent = selectedSpyFull ? tt('spymasterFull') : tt('joinRoom');
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
        if (title) title.textContent = uiLanguage === 'ar' ? 'الدخول كمشاهد' : 'Join as spectator';
        if (text) text.textContent = uiLanguage === 'ar' ? 'المشاهدون يتابعون اللعبة بدون تخمين أو تلميحات.' : 'Spectators can watch the game without guessing or giving clues.';
        document.querySelectorAll('.rolePick').forEach(b => b.classList.toggle('hidden', b.dataset.role !== 'spectator'));
    } else {
        if (title) title.textContent = uiLanguage === 'ar' ? `اختر دورك في ${teamName(team)}` : `Choose your ${teamName(team)} role`;
        if (text) text.textContent = uiLanguage === 'ar' ? 'اختر لاعب تخمين لاختيار البطاقات، أو صاحب تلميح لإعطاء التلميحات.' : 'Pick Operative to guess cards, or Spymaster to give clues.';
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
    if (title) title.textContent = isDiscordActivity ? tt('chooseRole') : tt('chooseTeam');
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
    const generated = roomCodeFromSeed(seed);
    const saved = readSavedDiscordActivitySeat();
    const currentScope = discordScopeKey();
    const sameScope = !saved?.scopeKey || saved.scopeKey === currentScope || currentScope === 'activity';
    if (saved?.roomId && sameScope) return String(saved.roomId).toUpperCase();
    return generated;
}

let activityRestoreInFlight = false;
let lastActivityRestoreAt = 0;

function restoreDiscordActivitySeat(reason = '', options = {}) {
    if (!isDiscordActivity || !socket?.connected) return false;
    const force = !!options.force;
    const saved = readSavedDiscordActivitySeat();
    const current = me();
    if (!force && state && current && current.online !== false) return false;
    if (!saved?.team || !saved?.role) return false;
    if (activityRestoreInFlight) return true;
    if (Date.now() - lastActivityRestoreAt < 900) return true;

    const roomCode = String(saved.roomId || getDiscordActivityRoomCode()).trim().toUpperCase();
    if (!roomCode) return false;

    activityRestoreInFlight = true;
    lastActivityRestoreAt = Date.now();
    roomInput.value = roomCode;
    discordActivityRoomCode = roomCode;
    selectedTeamChoice = saved.team;
    selectedRoleChoice = saved.role;
    const teamSel = $('team'), roleSel = $('role');
    if (teamSel) teamSel.value = saved.team;
    if (roleSel) roleSel.value = saved.role;
    if (saved.character && !hasCustomAvatar()) selectedCharacter = saved.character;
    if (saved.playerKey) setPlayerKey(saved.playerKey);

    socket.emit('getRoomInfo', {roomId: roomCode}, res => {
        if (!res?.ok) {
            activityRestoreInFlight = false;
            refreshDiscordLobbyPreview(true);
            return;
        }
        applyLobbyInfo(res);
        const payload = discordJoinPayload(saved.team, saved.role);
        payload.roomId = roomCode;
        payload.activityId = roomCode;
        payload.playerKey = saved.playerKey || payload.playerKey;
        payload.adminToken = getAdminToken(roomCode) || saved.adminToken || payload.adminToken;
        socket.emit('joinOrCreateActivityRoom', {...payload, resume: true, restoreReason: reason}, joinRes => {
            activityRestoreInFlight = false;
            acceptJoinResponse(joinRes || {ok: false, error: 'Could not restore Discord activity seat.'});
        });
    });
    return true;
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
        adminToken: getAdminToken(roomCode),
        language: uiLanguage,
        arabicMode: uiLanguage === 'ar'
    };
}

async function joinDiscordActivity(team, role) {
    if (!nameInput.value.trim()) {
        toast(tt('writeName'));
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
            toast(tt('characterTakenFirst'));
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
        if (title) title.textContent = tt('chooseRole');
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

window.addEventListener('pageshow', () => {
    restoreDiscordActivitySeat('pageshow', {force: true});
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') restoreDiscordActivitySeat('visible', {force: true});
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
    if (!players || !players.length) return `<div class="discordSeatEmpty">${uiLanguage === 'ar' ? 'فارغ' : 'empty'}</div>`;
    const seen = new Set();
    const unique = [];
    for (const p of players) {
        const key = p?.discordId || p?.id || `${p?.name || 'player'}_${unique.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
    }
    return unique.map(p => `<div class="discordSeatMini discordSeatLarge ${p.isPreview ? 'pendingSeat' : ''}">${avatarHtml(p, 'lobbyAvatar')}<span class="seatName">${escapeHtml(p.name || (uiLanguage === 'ar' ? 'لاعب' : 'Player'))}</span>${p.isAdmin ? `<em>${uiLanguage === 'ar' ? 'مدير' : 'Admin'}</em>` : ''}${p.isPreview ? `<em>${uiLanguage === 'ar' ? 'أنت' : 'You'}</em>` : ''}</div>`).join('');
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
            const occupied = players.some(p => p && !p.isPreview);
            btn.disabled = occupied;
            btn.textContent = occupied ? tt('full') : (uiLanguage === 'ar' ? 'دخول' : 'Join');
        } else if (btn) {
            btn.textContent = role === 'spectator'
                ? (uiLanguage === 'ar' ? 'الدخول كمشاهد' : 'Join as Spectator')
                : (uiLanguage === 'ar' ? 'دخول' : 'Join');
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
applyLanguage();

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
    renderHomepageLobbyPreview(res, true);
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
                toast(tt('characterTakenFirst'));
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
        adminToken: getAdminToken(code),
        language: uiLanguage,
        arabicMode: uiLanguage === 'ar'
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
    if (isDiscordActivity) {
        saveDiscordActivitySeat({
            roomId: res.roomId || roomInput?.value,
            playerKey: res.playerKey || playerKey,
            team: $('team')?.value || selectedTeamChoice,
            role: $('role')?.value || selectedRoleChoice
        });
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
            showGameIntro(state.status === 'lobby' ? 'join-lobby' : 'join-game');
        }
    }
}

$('createBtn').onclick = () => {
    if (isDiscordActivity) return joinDiscordActivity($('team').value || 'spectator', $('role').value || 'spectator');
    socket.emit('createRoom', joinPayload(), acceptJoinResponse);
};
const singlePlayerBtn = $('singlePlayerBtn');
const modesBtn = $('modesBtn');
const modesMenu = $('modesMenu');
const arabicModeBtn = $('arabicModeBtn');
if (modesBtn && modesMenu) {
    modesBtn.onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        modesMenu.classList.toggle('hidden');
        $('backgroundMenu')?.classList.add('hidden');
    };
    document.addEventListener('click', ev => {
        if (ev.target.closest('.modesFloating')) return;
        modesMenu.classList.add('hidden');
        $('backgroundMenu')?.classList.add('hidden');
    });
}
const backgroundBtn = $('backgroundBtn');
const backgroundMenu = $('backgroundMenu');
if (backgroundBtn && backgroundMenu) {
    backgroundBtn.onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        backgroundMenu.classList.toggle('hidden');
        modesMenu?.classList.add('hidden');
    };
    document.querySelectorAll('.bgChoice').forEach(btn => {
        btn.onclick = ev => {
            ev.preventDefault();
            applyBackgroundTheme(btn.dataset.bgTheme);
            backgroundMenu.classList.add('hidden');
        };
    });
    applyBackgroundTheme(getSavedBackgroundTheme());
    refreshBackgroundChooserText();
}
if (arabicModeBtn) {
    arabicModeBtn.onclick = ev => {
        ev.preventDefault();
        withModeHostAccess(() => {
            if (state && game && !game.classList.contains('hidden')) {
                toast(uiLanguage === 'ar' ? 'ارجع للصفحة الرئيسية لتغيير وضع اللغة.' : 'Go back to the home page to change the room mode.');
                modesMenu?.classList.add('hidden');
                return;
            }
            uiLanguage = uiLanguage === 'ar' ? 'en' : 'ar';
            applyLanguage();
            renderCharacters();
            modesMenu?.classList.add('hidden');
        });
    };
}
if (singlePlayerBtn) {
    singlePlayerBtn.onclick = () => {
        withModeHostAccess(() => {
            modesMenu?.classList.add('hidden');
            const overlay = $('singleDifficultyOverlay');
            if (overlay) {
                overlay.classList.remove('hidden');
                return;
            }
            startSinglePlayer('medium');
        });
    };
}

const AI_ENGINE_OFFLINE_MESSAGE = "the host's pc where he hosts the ai engine that runs this mode is turned off at the moment";

async function checkAiEngineBeforeSinglePlayer() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
        const res = await fetch('/api/ai-clue-status', {signal: controller.signal});
        const data = await res.json().catch(() => ({}));
        return !!data?.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

async function startSinglePlayer(difficulty = 'medium') {
    difficulty = ['easy', 'medium', 'extreme'].includes(difficulty) ? difficulty : 'medium';
    const selectedLanguage = localStorage.cc_language === 'ar' || uiLanguage === 'ar' ? 'ar' : 'en';
    socket.emit('setLanguage', {language: selectedLanguage});
    if (singlePlayerBtn) {
        localStorage.cc_name = currentDisplayName() || 'Agent';
        singlePlayerBtn.disabled = true;
        singlePlayerBtn.textContent = tt('checkingAi');
    }
    const aiReady = await checkAiEngineBeforeSinglePlayer();
    if (!aiReady) {
        if (singlePlayerBtn) {
            singlePlayerBtn.disabled = false;
        singlePlayerBtn.textContent = 'Single Player / لاعب فردي';
        }
        toast(tt('offlineAi'));
        return;
    }
    if (singlePlayerBtn) {
        singlePlayerBtn.textContent = tt('starting');
    }
    socket.emit('createSinglePlayerRoom', {
        name: currentDisplayName(),
        avatar: customAvatar || '',
        character: outboundCharacter(),
        difficulty,
        language: selectedLanguage,
        arabicMode: selectedLanguage === 'ar',
        playerKey
    }, res => {
        if (singlePlayerBtn) {
            singlePlayerBtn.disabled = false;
            singlePlayerBtn.textContent = 'Single Player / لاعب فردي';
        }
        if (res?.ok === false && res.error === AI_ENGINE_OFFLINE_MESSAGE) toast(tt('offlineAi'));
        acceptJoinResponse(res);
    });
}

const singleDifficultyOverlay = $('singleDifficultyOverlay');
const closeSingleDifficulty = $('closeSingleDifficulty');
if (closeSingleDifficulty) closeSingleDifficulty.onclick = () => singleDifficultyOverlay?.classList.add('hidden');
document.querySelectorAll('[data-single-difficulty]').forEach(btn => {
    btn.onclick = () => {
        withModeHostAccess(() => {
            singleDifficultyOverlay?.classList.add('hidden');
            startSinglePlayer(btn.dataset.singleDifficulty || 'medium');
        });
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
            toast(tt('characterTakenFirst'));
            renderCharacters();
            return;
        }
        socket.emit('joinRoom', {...joinPayload(), roomId}, acceptJoinResponse);
    });
};

socket.on('connect', () => {
    myId = playerKey;
    if (isDiscordActivity) {
        if (!restoreDiscordActivitySeat('socket-connect', {force: true})) refreshDiscordLobbyPreview(true);
        return;
    }
    requestLobbyInfo();
});
socket.on('lobbyInfo', res => {
    applyLobbyInfo(res);
});
socket.on('identityKey', ({playerKey: newKey} = {}) => {
    if (newKey) {
        setPlayerKey(newKey);
    }
});
socket.on('toast', msg => toast(msg === AI_ENGINE_OFFLINE_MESSAGE ? tt('offlineAi') : msg));
socket.on('adminRequest', req => {
    const current = me();
    if (!current?.isAdmin || !req) return;
    showAdminRequestPopup(req);
});
socket.on('kicked', ({roomId, message} = {}) => {
    toast(message || 'You were kicked from the room. You can join back if you want.');
    if (isDiscordActivity) clearSavedDiscordActivitySeat();
    state = null;
    targetIds.clear();
    lastRevealed.clear();
    clearDelayedReveals();
    clearLocalPickedFlips();
    setPlayerKey(makePlayerKey());
    if (roomId) roomInput.value = roomId;
    game.classList.add('hidden');
    landing.classList.remove('hidden');
    requestLobbyInfo();
    setJoinButtonsReady();
});
socket.on('state', s => {
    const before = state;
    const clueAccepted = !!(before && s?.clue?.word && (before?.clue?.at !== s.clue.at || before?.clue?.word !== s.clue.word || before?.clue?.number !== s.clue.number || before?.clue?.team !== s.clue.team));
    const turnChanged = before && before.turn !== s.turn;
    const newFinishedGame = before && before.status !== 'finished' && s.status === 'finished';
    const gameJustStarted = before?.status === 'lobby' && s.status !== 'lobby';
    const enteredGameFromLanding = !!(landing && !landing.classList.contains('hidden') && !(isDiscordActivity && s.status === 'lobby'));
    const boardChanged = !!(before?.board && s?.board && before.board.map(c => `${c.id}:${c.word}`).join('|') !== s.board.map(c => `${c.id}:${c.word}`).join('|'));
    if (boardChanged) {
        clearDelayedReveals();
        clearLocalPickedFlips();
    }
    const delayedReveals = scheduleDelayedReveals(before, s);
    const hasDelayedReveal = delayedReveals.length > 0;
    if (hasDelayedReveal && s?.status === 'finished' && s?.winner) {
        hideWinEffectsForCurrentView();
    }
    if (clueAccepted || turnChanged || newFinishedGame) {
        targetIds.clear();
        const cw = $('clueWord');
        if (cw) cw.value = '';
        clueNumberEdited = false;
        lastClueTargetCount = 0;
    }
    state = s;
    if (s?.language && s.language !== uiLanguage) {
        uiLanguage = s.language === 'ar' ? 'ar' : 'en';
        applyLanguage();
    }
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
    if (gameJustStarted) {
        lastBoardKey = '';
        clearDelayedReveals();
        clearLocalPickedFlips();
        showGameIntro('start');
    }
    if (landing && !landing.classList.contains('hidden')) {
        landing.classList.add('hidden');
        game.classList.remove('hidden');
    }
    if (enteredGameFromLanding) showGameIntro(s.status === 'lobby' ? 'join-lobby' : 'join-game');
    if (before?.clue?.at !== s.clue?.at && s.clue) sound('clue');
    if (newFinishedGame && !hasDelayedReveal) playGameWinSoundOnce();
    if (!hasDelayedReveal) detectRevealSound(before, s);
    render();
    if (clueAccepted) showSpymasterClueSplash(s.clue);
    animateScoreChanges(before, s);
    if (!hasDelayedReveal) animateNewReveals(before, s);
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


function currentWinEffectKey() {
    if (!(state?.status === 'finished' && state?.winner)) return '';
    return `${state.id || ''}-${state.round || 0}-${state.winner}-${state.status}`;
}

function hideWinEffectsForCurrentView(options = {}) {
    const keepCup = !!options.keepCup;
    const modal = $('winModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('docked', 'winBlue', 'winRed');
    }
    const badge = $('winnerBadge');
    if (badge) {
        badge.className = 'hidden';
        badge.textContent = '';
    }
    $('goldPanel')?.classList.remove('winnerPanel');
    $('blackPanel')?.classList.remove('winnerPanel');
    if (!keepCup) {
        $('goldPanel')?.classList.remove('winnerCupPanel');
        $('blackPanel')?.classList.remove('winnerCupPanel');
    }
}

function renderWinModal() {
    const modal = $('winModal');
    if (!modal) return;
    const key = currentWinEffectKey();
    const won = !!key;
    if (won && pendingRevealIds.size > 0) {
        modal.classList.add('hidden');
        modal.classList.remove('docked', 'winBlue', 'winRed');
        if (winDockTimer) {
            clearTimeout(winDockTimer);
            winDockTimer = null;
        }
        return;
    }
    if (won && winRevealHoldUntil && Date.now() < winRevealHoldUntil) {
        modal.classList.add('hidden');
        modal.classList.remove('docked', 'winBlue', 'winRed');
        if (winDockTimer) {
            clearTimeout(winDockTimer);
            winDockTimer = null;
        }
        return;
    }
    if (!won) {
        modal.classList.add('hidden');
        modal.classList.remove('docked', 'winBlue', 'winRed');
        if (winDockTimer) {
            clearTimeout(winDockTimer);
            winDockTimer = null;
        }
        lastWinKey = null;
        hiddenWinEffectKey = '';
        winRevealHoldUntil = 0;
        return;
    }

    if (hiddenWinEffectKey === key) {
        hideWinEffectsForCurrentView({keepCup: true});
        return;
    }

    const name = teamUpper(state.winner);
    $('winModalTitle').textContent = tt('teamWon', {team: name});
    $('winModalText').textContent = tt('congratulations');
    modal.classList.remove('hidden', 'docked', 'winBlue', 'winRed');

    if (lastWinKey !== key) {
        lastWinKey = key;
        if (winDockTimer) clearTimeout(winDockTimer);
        // Show the congratulations/winner effects briefly, then hide them automatically.
        winDockTimer = setTimeout(() => {
            winDockTimer = null;
            if (currentWinEffectKey() !== key) return;
            hiddenWinEffectKey = key;
            hideWinEffectsForCurrentView({keepCup: true});
        }, 3200);
    }
}


function render() {
    const p = me();
    const passBtn = $('endTurnBtn');
    if (passBtn) passBtn.textContent = tt('pass');
    const roomLbl = $('roomLabel');
    if (roomLbl) roomLbl.textContent = '';
    updateInviteFields(state.id);
    $('turnBadge').className = 'hidden';
    $('turnBadge').textContent = '';
    $('clueBadge').className = `badge turnSubStatus ${state.turn}`;
    $('clueBadge').innerHTML = turnStatusHtml();
    const activeWinKey = currentWinEffectKey();
    const winEffectsBlocked = pendingRevealIds.size > 0 || !!(winRevealHoldUntil && Date.now() < winRevealHoldUntil);
    const showWinEffects = !!(state.winner && hiddenWinEffectKey !== activeWinKey && !winEffectsBlocked);
    const showWinnerCup = !!(state.winner && !winEffectsBlocked);
    $('winnerBadge').className = showWinEffects ? `badge ${state.winner}` : 'hidden';
    $('winnerBadge').textContent = showWinEffects ? tt('wins', {team: teamUpper(state.winner)}) : '';
    updateScoreDisplay(state.points?.blue ?? 9, state.points?.red ?? 9);
    const gs = $('goldSideScore'), bs = $('blackSideScore');
    if (gs) gs.textContent = state.points?.blue ?? 9;
    if (bs) bs.textContent = state.points?.red ?? 9;
    const gp = $('goldPanel'), bp = $('blackPanel');
    if (gp) {
        gp.classList.toggle('winnerPanel', showWinEffects && state.winner === 'blue');
        gp.classList.toggle('winnerCupPanel', showWinnerCup && state.winner === 'blue');
    }
    if (bp) {
        bp.classList.toggle('winnerPanel', showWinEffects && state.winner === 'red');
        bp.classList.toggle('winnerCupPanel', showWinnerCup && state.winner === 'red');
    }
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
        el.innerHTML = `<span class="currentClueLabel">${tt('currentClue')}</span><b>${String(state.clue.word || '').toUpperCase()}</b><strong>${Number(state.clue.number || 0)}</strong>`;
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
    const roleLabel = p.role === 'spymaster' ? tt('spymaster') : p.role === 'operative' ? tt('operative') : tt('spectator');
    $('meCard').innerHTML = `<div class="player ${p.team}">${avatarHtml(p)}<div><b>${p.name}</b><span class="roleTag">${teamName(p.team)} · ${roleLabel}</span></div></div>`;
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
    panel.dataset.mobileTeamOpen = open ? 'true' : 'false';
    btn.textContent = open ? tt('hideTeam') : tt('showTeam');
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
        const canAdminManageTarget = !!(adminMode && !p.isAdmin);
        const kickButton = canAdminManageTarget ? `<button type="button" data-admin-kick="${p.id}">Kick</button>` : '';
        const assignButton = canAdminManageTarget ? `<button type="button" data-admin-assign="${p.id}">Assign Admin</button>` : '';
        return `<div class="adminActions playerOptionsWrap">
            <button class="playerOptionsBtn" type="button" data-player-options="${p.id}">${tt('options')}</button>
            <div class="playerOptionsMenu">
                ${kickButton}
                ${assignButton}
                <button type="button" data-admin-rename="${p.id}">Edit Name</button>
            </div>
        </div>`;
    }

    function playerHtml(p) {
        const offline = p.online === false;
        const adminBadge = p.isAdmin ? '<span class="adminBadge adminCrown" title="Admin">👑</span>' : '';
        const canDrag = playerOptionsMode && p.id !== myId && (!p.isAdmin || adminMode);
        return `<div class="player ${p.team} ${offline ? 'offline' : ''} ${canDrag ? 'draggablePlayer' : ''} ${p.isAdmin ? 'adminPlayer' : ''}" data-player-id="${p.id}" draggable="${canDrag ? 'true' : 'false'}">${avatarHtml(p)}<div class="playerBody"><b class="${p.isAdmin ? 'adminNameLine' : ''}"><span class="playerNameText">${escapeHtml(p.name || 'Player')}</span><span class="inlineNameEditor hidden"><input type="text" maxlength="28" value="${escapeHtml(p.name || 'Player')}" aria-label="Player name"><button type="button" data-inline-name-save="${p.id}">Save</button><button type="button" data-inline-name-cancel="${p.id}">Cancel</button></span>${adminBadge}${offline ? '<span class="offlineIcon" title="Offline">📡</span>' : ''}</b>${adminTools(p)}</div></div>`;
    }

    function playerCardById(id) {
        const safeId = window.CSS?.escape ? CSS.escape(String(id || '')) : String(id || '').replace(/["\\]/g, '');
        return document.querySelector(`.player[data-player-id="${safeId}"]`);
    }

    function showInlineNameEditor(playerId) {
        const card = playerCardById(playerId);
        if (!card) return;
        const editor = card.querySelector('.inlineNameEditor');
        const label = card.querySelector('.playerNameText');
        const input = editor?.querySelector('input');
        if (!editor || !label || !input) return;
        card.classList.add('editingName');
        label.classList.add('hidden');
        editor.classList.remove('hidden');
        input.focus();
        input.select();
    }

    function hideInlineNameEditor(playerId) {
        const card = playerCardById(playerId);
        if (!card) return;
        card.classList.remove('editingName');
        card.querySelector('.playerNameText')?.classList.remove('hidden');
        card.querySelector('.inlineNameEditor')?.classList.add('hidden');
    }

    function saveInlineName(playerId) {
        const card = playerCardById(playerId);
        const input = card?.querySelector('.inlineNameEditor input');
        const cleanName = String(input?.value || '').trim();
        if (!cleanName) return toast(uiLanguage === 'ar' ? 'لا يمكن أن يكون الاسم فارغا.' : 'Name cannot be empty.');
        socket.emit('adminUpdatePlayer', {playerId, action: 'changeName', name: cleanName});
        hideInlineNameEditor(playerId);
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

    $('goldOperatives').innerHTML = teams.blue.operative.map(playerHtml).join('') || empty(tt('noOperatives'));
    $('goldSpymasters').innerHTML = teams.blue.spymaster.map(playerHtml).join('') || empty(tt('noSpymaster'));
    $('blackOperatives').innerHTML = teams.red.operative.map(playerHtml).join('') || empty(tt('noOperatives'));
    $('blackSpymasters').innerHTML = teams.red.spymaster.map(playerHtml).join('') || empty(tt('noSpymaster'));
    $('spectators').innerHTML = teams.spectator.spectator.map(playerHtml).join('') || empty(tt('noSpectators'));
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
            socket.emit('adminUpdatePlayer', {playerId: target, action: 'kick'}, res => {
                if (res?.ok === false) toast(res.error || 'Could not kick player.');
                else if (res?.message) toast(res.message);
            });
        };
    });
    document.querySelectorAll('[data-admin-assign]').forEach(btn => {
        btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            closePlayerOptionsMenus();
            const target = btn.dataset.adminAssign;
            socket.emit('adminUpdatePlayer', {playerId: target, action: 'assignAdmin'}, res => {
                if (res?.ok === false) toast(res.error || 'Could not assign admin.');
                else if (res?.message) toast(res.message);
            });
        };
    });
    document.querySelectorAll('[data-admin-rename]').forEach(btn => {
        btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const target = btn.dataset.adminRename;
            closePlayerOptionsMenus();
            showInlineNameEditor(target);
        };
    });
    document.querySelectorAll('[data-inline-name-save]').forEach(btn => {
        btn.onclick = ev => {
            ev.preventDefault();
            ev.stopPropagation();
            saveInlineName(btn.dataset.inlineNameSave);
        };
    });
    document.querySelectorAll('[data-inline-name-cancel]').forEach(btn => {
        btn.onclick = ev => {
            ev.preventDefault();
            ev.stopPropagation();
            hideInlineNameEditor(btn.dataset.inlineNameCancel);
        };
    });
    document.querySelectorAll('.inlineNameEditor input').forEach(input => {
        input.onkeydown = ev => {
            if (ev.key === 'Enter') saveInlineName(input.closest('.player')?.dataset.playerId);
            if (ev.key === 'Escape') hideInlineNameEditor(input.closest('.player')?.dataset.playerId);
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
    if (gc) gc.textContent = tt('players', {count: goldCount, suffix: goldCount === 1 ? '' : 's'});
    if (bc) bc.textContent = tt('players', {count: blackCount, suffix: blackCount === 1 ? '' : 's'});
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
    document.body.dataset.turnTeam = activeTeam;
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
    const isSpy = p?.role === 'spymaster';
    const isCurrentSpy = isSpy && p.team === state?.turn && (state?.status === 'waiting-clue' || (hintMode && state?.status === 'guessing'));
    // Do not disable the Give Clue button just because no target is selected yet.
    // A disabled button creates a "does nothing" click; the click handler below now shows the proper toast.
    if (btn) {
        // Keep the button clickable so the user gets a toast instead of a dead button.
        // The click handler and server still enforce spymaster/turn rules.
        btn.disabled = state?.status === 'lobby' || state?.status === 'finished';
        btn.classList.toggle('needsClueTarget', !!(isCurrentSpy && !hintMode && n < 1));
    }
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

function localPickedFlipKey(card) {
    return `${state?.id || ''}:${state?.round ?? 0}:${card?.id ?? ''}`;
}

function isLocalPickedFlipEligible(card) {
    if (!card || !card.revealed) return false;
    if (state?.status === 'finished') return false;
    if (pendingRevealIds.has(card.id)) return false;
    return card.color === 'blue' || card.color === 'red' || card.color === 'neutral';
}

function clearLocalPickedFlips() {
    localFlippedPickedCards.clear();
}

function pruneLocalPickedFlips() {
    if (!state?.board?.length) {
        clearLocalPickedFlips();
        return;
    }
    const liveKeys = new Set(state.board.filter(isLocalPickedFlipEligible).map(localPickedFlipKey));
    for (const key of Array.from(localFlippedPickedCards)) {
        if (!liveKeys.has(key)) localFlippedPickedCards.delete(key);
    }
}

function revealHeroSvg(color) {
    return '';
}

function renderBoard() {
    if (state?.status === 'lobby') {
        board.classList.remove('spyBoard', 'operativeBoard', 'hasPendingReveal');
        board.parentElement?.classList.remove('hasPendingRevealWrap');
        board.innerHTML = `<div class="waitingBoard">${uiLanguage === 'ar' ? 'بانتظار المدير لبدء اللعبة...' : 'Waiting for admin to start the game...'}</div>`;
        return;
    }
    const p = me();
    const spy = p?.role === 'spymaster';
    pruneLocalPickedFlips();
    board.classList.toggle('spyBoard', !!spy);
    board.classList.toggle('operativeBoard', !spy);
    board.classList.toggle('finishedBoard', state.status === 'finished');
    board.classList.toggle('hasPendingReveal', pendingRevealIds.size > 0);
    board.parentElement?.classList.toggle('hasPendingRevealWrap', pendingRevealIds.size > 0);
    const marked = myMarkedIds();
    // Spawn animation should happen only for a truly fresh board, not for votes/reveals/turn changes.
    // Do not include visible colors, revealed state, votes, or round number here because those
    // change during normal play and would reanimate every card.
    const boardKey = `${state.id}-${state.board.map(c => `${c.id}:${c.word}`).join('|')}`;
    const shouldSpawn = boardKey !== lastBoardKey;
    lastBoardKey = boardKey;
    board.innerHTML = state.board.map((c, i) => {
        const pendingReveal = !!(c.revealed && pendingRevealIds.has(c.id));
        const showOrigin = state.status === 'finished' && !pendingReveal;
        const visuallyRevealed = !!c.revealed && !pendingReveal;
        const colorClass = pendingReveal ? '' : (((visuallyRevealed || spy || showOrigin) && c.color) ? c.color : '');
        // Spymaster clue-target selections should show the crown only, without the old cyan border/tick.
        const spyClueTarget = !c.revealed && spy && (c.clueTarget || targetIds.has(c.id));
        const voteCount = state.voteInfo?.counts?.[c.id] || 0;
        const agreed = state.voteInfo?.agreedCardId === c.id;
        const myVote = marked.includes(c.id);
        const voted = voteCount > 0;
        const revealer = c.revealedById ? state?.players?.[c.revealedById] : null;
        // During play, revealed team/grey cards become crown-only. After the win, show every real word/color.
        // Clicking a crown-only revealed card flips it locally for this browser only, without emitting to the server.
        const teamReveal = !!(!showOrigin && visuallyRevealed && (c.color === 'blue' || c.color === 'red'));
        const correctReveal = teamReveal;
        const neutralReveal = !!(!showOrigin && visuallyRevealed && c.color === 'neutral');
        const localFlippedReveal = (teamReveal || neutralReveal) && localFlippedPickedCards.has(localPickedFlipKey(c));
        const playableSpyTarget = spy && p?.team === state.turn && state.status === 'waiting-clue' && c.color === p.team && !c.revealed;
        const canConfirmThis = p?.role === 'operative' && p.team === state.turn && state.status === 'guessing' && myVote && !c.revealed;
        const voteBadge = '';
        const voteFaces = voted && !c.revealed ? voteFacesHtml(c.id) : '';
        const confirmMini = canConfirmThis ? `<span class="cardConfirm" data-confirm-id="${c.id}" title="Confirm ${c.word}">✓</span>` : '';
        const revealBadge = visuallyRevealed ? revealHeroSvg(c.color) : '';
        // Use a real centered crown layer instead of card backgrounds/pseudo-elements.
        // This avoids mobile Safari/Discord cropping the crown into the top-left corner.
        const crownSrc = neutralReveal ? '/crown-bw.png' : '/crown.png';
        const hasCrownLayer = spyClueTarget || ((teamReveal || neutralReveal) && !localFlippedReveal);
        const crownLayer = hasCrownLayer ? `<img class="cardCrownLayer ${neutralReveal ? 'cardCrownBwLayer' : ''}" src="${crownSrc}" alt="" aria-hidden="true">` : '';
        const crownOnlyReveal = (teamReveal || neutralReveal) && !localFlippedReveal;
        const finalWordStyle = `--letters:${String(c.word).length}`;
        const wordLayer = crownOnlyReveal ? '' : `<span class="word ${cardLengthClass(c.word)} ${showOrigin ? 'finalWordBox' : ''}" style="${finalWordStyle}">${c.word}</span>`;
        return `<button class="card ${shouldSpawn ? 'spawnCard' : ''} ${colorClass} ${visuallyRevealed ? 'revealed' : ''} ${pendingReveal ? 'pendingReveal' : ''} ${correctReveal ? 'correctReveal' : ''} ${teamReveal ? 'teamReveal' : ''} ${neutralReveal ? 'neutralReveal' : ''} ${crownOnlyReveal ? 'crownOnlyReveal' : ''} ${localFlippedReveal ? 'localWordFlipped' : ''} ${showOrigin ? 'originShown finalOriginShown' : ''} ${spyClueTarget ? 'spyClueTarget' : ''} ${hasCrownLayer ? 'hasCrownLayer' : ''} ${playableSpyTarget ? 'spyPickable' : ''} ${voted ? 'voted pickedByOperative' : ''} ${visuallyRevealed ? 'pickedByOperative' : ''} ${agreed ? 'agreed' : ''} ${myVote ? 'myVote' : ''}" data-id="${c.id}" title="${c.word}" style="--spawn:${i}">${revealBadge}${crownLayer}${wordLayer}${voteBadge}${voteFaces}${confirmMini}</button>`;
    }).join('');
    board.querySelectorAll('.card').forEach(el => {
        el.onclick = (ev) => {
            if (ev.target.closest('.cardConfirm')) return;
            const id = Number(el.dataset.id);
            const card = state.board.find(c => c.id === id);
            if (isLocalPickedFlipEligible(card)) {
                const key = localPickedFlipKey(card);
                if (localFlippedPickedCards.has(key)) localFlippedPickedCards.delete(key);
                else localFlippedPickedCards.add(key);
                renderBoard();
                return;
            }
            const p = me();
            if (!p || !card || card.revealed || state.status === 'finished') return;
            if (p.role === 'spymaster') {
                if (state.status !== 'waiting-clue') {
                    toast(uiLanguage === 'ar' ? 'انتظر دور التلميح قبل اختيار البطاقات.' : 'Wait for the clue turn before choosing cards.');
                    return;
                }
                if (p.team !== state.turn) {
                    toast(uiLanguage === 'ar' ? `الدور لفريق ${teamName(state.turn)} وليس لفريقك.` : `It is ${teamName(state.turn)}'s turn, not your team.`);
                    return;
                }
                if (state?.hintRequested && state.hintRequested.team === p.team) {
                    toast(uiLanguage === 'ar' ? 'التلميحات الإضافية لا تحتاج اختيار بطاقات.' : 'Extra hints do not need card selection.');
                    return;
                }
                if (card.color == null) {
                    toast(uiLanguage === 'ar' ? 'لون البطاقة لم يجهز بعد. حاول بعد لحظة.' : 'Card color is still loading. Try again in a second.');
                    return;
                }
                if (card.color !== p.team) {
                    toast(uiLanguage === 'ar' ? 'صاحب التلميح يختار بطاقات من لون فريقه فقط.' : 'Spymasters can only choose cards from their own team color.');
                    return;
                }
                if (targetIds.has(id)) {
                    targetIds.delete(id);
                } else {
                    targetIds.add(id);
                }
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
            $('dockTitle').textContent = tt('giveClue');
            $('dockHelp').textContent = '';
        } else if (isAnySpy) {
            $('dockTitle').textContent = tt('waiting');
            $('dockHelp').textContent = '';
        }
    }

    const newRound = $('newRoundBtn');
    if (newRound) {
        const waitingForWinningReveal = pendingRevealIds.size > 0 || !!delayedWinRevealTimer || !!(winRevealHoldUntil && Date.now() < winRevealHoldUntil);
        newRound.classList.toggle('hidden', state.status !== 'finished' || waitingForWinningReveal);
    }
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
        const title = uiLanguage === 'ar' ? `${by || 'لاعب'} اختار ${word}` : `${by || 'Player'} chose ${word}`;
        return `<div class="gameLogEntry pickLog ${color} ${lenClass(word)}" title="${title}"><b class="logPickWord">${face}<span>${word}</span></b></div>`;
    }

    function passHtml(parts) {
        const team = parts[1];
        const by = parts[2] || '';
        const avatar = parts[3] || '';
        const character = parts[4] || characterForName(by, team);
        const face = logFace(character, by, 'logUserAvatar', avatar);
        const title = uiLanguage === 'ar' ? `${by || 'لاعب'} مرر الدور` : `${by || 'Player'} passed`;
        return `<div class="gameLogEntry passLog ${team}" title="${title}"><b class="logPickWord">${face}<span class="teamTick">✓</span></b></div>`;
    }

    const pendingPickKeys = new Set([...pendingRevealIds].map(id => {
        const c = state?.board?.find(card => card.id === id);
        return c ? `${c.color}|${String(c.word || '').toUpperCase()}` : '';
    }).filter(Boolean));
    const entries = (state.log || []).filter(x => {
        if (!['blue', 'red'].includes(entryTeam(x))) return false;
        const parts = String(x || '').split('|');
        if (parts[0] === 'PICK' && pendingPickKeys.has(`${parts[2]}|${String(parts[3] || '').toUpperCase()}`)) return false;
        return true;
    });
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
    </div>`).join('')}</div>` : `<div class="gameLogEmpty">${tt('noGuesses')}</div>`;
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
        toast(uiLanguage === 'ar' ? 'ادخل الغرفة أولا.' : 'Join the room first.');
        return;
    }

    // Discord Activities / iframes can silently block native confirm() dialogs,
    // so the Options buttons must not depend on confirm() to run.
    if (current.isAdmin || current.role === 'spymaster') {
        targetIds.clear();
        socket.emit(action);
        toast(uiLanguage === 'ar' ? 'تم تطبيق الخيار.' : `${label || 'Option'} applied.`);
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
wireOptionButton('landingResetTableBtn', 'resetTable', 'Reset Table', 'Reset the table with a fresh board but keep the same room and players?');
wireOptionButton('landingShuffleTeamsBtn', 'shuffleTeams', 'Shuffle Teams', 'Shuffle online players between Gold and Black teams?');
const newGameBtn = $('newGameBtn');
if (newGameBtn) newGameBtn.onclick = () => {
    if (confirm(uiLanguage === 'ar' ? 'بدء لوحة جديدة في هذه الغرفة؟' : 'Start a new board in this room?')) {
        targetIds.clear();
        socket.emit('newGame');
    }
};
const giveClueButton = $('giveClueBtn');
if (giveClueButton) giveClueButton.onclick = () => {
    const targets = [...targetIds];
    const clueWord = String($('clueWord')?.value || '').trim();
    const p = me();
    const rawNumber = parseInt($('clueNumber')?.value || '', 10);
    let clueNumberValue = Number.isFinite(rawNumber) ? Math.max(0, rawNumber) : targets.length;

    if (!p || p.role !== 'spymaster') {
        toast(uiLanguage === 'ar' ? 'صاحب التلميح فقط يمكنه إعطاء تلميح.' : 'Only the spymaster can give a clue.');
        return;
    }
    if (!clueWord) {
        toast(uiLanguage === 'ar' ? 'اكتب كلمة التلميح أولا.' : 'Write a clue word first.');
        return;
    }
    if (clueNumberValue < 1 && targets.length > 0) clueNumberValue = targets.length;
    if (clueNumberValue < 1) {
        toast(uiLanguage === 'ar' ? 'اختر بطاقة واحدة على الأقل أو اكتب رقم التلميح.' : 'Pick at least one card or type a clue number.');
        return;
    }

    socket.emit('giveClue', {word: clueWord, number: clueNumberValue, targetIds: targets});
};
const clueNumberInput = $('clueNumber');
if (clueNumberInput) {
    clueNumberInput.removeAttribute('max');
    clueNumberInput.addEventListener('input', () => {
        clueNumberEdited = true;
        const value = Math.max(0, parseInt(clueNumberInput.value || '0', 10) || 0);
        clueNumberInput.value = value;
        syncClueCount();
    });
}
const newRoundBtn = $('newRoundBtn');
if (newRoundBtn) newRoundBtn.onclick = () => {
    targetIds.clear();
    clearLocalPickedFlips();
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
            toast(uiLanguage === 'ar' ? 'تم نسخ رابط الدعوة.' : 'Invite link copied.');
        } catch {
            toast(uiLanguage === 'ar' ? 'رابط الدعوة جاهز.' : 'Invite link ready.');
        }
    } else toast(uiLanguage === 'ar' ? 'رابط الدعوة جاهز.' : 'Invite link ready.');
};
const topInviteBtn = $('topInviteBtn');
if (topInviteBtn) topInviteBtn.onclick = async () => {
    if (isDiscordActivity) return openDiscordInvite();
    updateInviteFields(state?.id || roomInput.value);
    const link = $('topInviteLink')?.value;
    if (link && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(link);
            toast(uiLanguage === 'ar' ? 'تم نسخ رابط الدعوة.' : 'Invite link copied.');
        } catch {
            toast(uiLanguage === 'ar' ? 'رابط الدعوة جاهز.' : 'Invite link ready.');
        }
    } else toast(uiLanguage === 'ar' ? 'رابط الدعوة جاهز.' : 'Invite link ready.');
};
const backToLobbyBtn = $('backToLobbyBtn');
if (backToLobbyBtn) backToLobbyBtn.onclick = () => {
    const currentRoom = state?.id || roomInput.value.trim().toUpperCase();
    socket.emit('leaveToLobby', () => {
        state = null;
        targetIds.clear();
        lastRevealed.clear();
        if (winDockTimer) {
            clearTimeout(winDockTimer);
            winDockTimer = null;
        }
        lastWinKey = null;
        hiddenWinEffectKey = '';
        hideWinEffectsForCurrentView();
        setPlayerKey(makePlayerKey());
        if (currentRoom) roomInput.value = currentRoom;
        if (isDiscordActivity) clearSavedDiscordActivitySeat();
        selectedTeamChoice = '';
        selectedRoleChoice = '';
        document.querySelectorAll('.teamPick,.rolePick').forEach(b => b.classList.remove('selected'));
        updateJoinSummary();
        setJoinButtonsReady();
        requestLobbyInfo();
        game.classList.add('hidden');
        landing.classList.remove('hidden');
        toast(uiLanguage === 'ar' ? 'اختر فريقا أو دورا جديدا ثم ادخل مرة أخرى.' : 'Choose a new team or role, then join again.');
    });
};
setInterval(() => {
    if (!state) return;
    $('roundTime').textContent = fmt(Date.now() - state.roundStartedAt);
    $('gameTime').textContent = fmt(Date.now() - state.gameStartedAt);
}, 500);
