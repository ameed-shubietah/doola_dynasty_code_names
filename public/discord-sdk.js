import {DiscordSDK} from "https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm";

const DISCORD_CLIENT_ID = "1514895948197793893";

function pick(obj, keys) {
    for (const key of keys) {
        const value = obj?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
}

function withTimeout(promise, ms, label = 'Timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))
    ]);
}

function avatarUrl(user) {
    // Discord profile images are intentionally not used. Players choose in-game characters instead.
    return '';
}

function displayName(user) {
    if (!user) return 'Discord User';
    return pick(user, [
        'global_name', 'globalName', 'display_name', 'displayName',
        'nick', 'nickname', 'member_nick', 'memberNick',
        'username', 'user_name', 'userName', 'name', 'display_name'
    ]) || 'Discord User';
}

function normalizeAnyUser(input) {
    const user = input?.user || input?.member?.user || input?.participant?.user || input || {};
    const member = input?.member || input?.participant?.member || {};
    const merged = {...(input || {}), ...(member || {}), ...(user || {})};

    return {
        id: pick(merged, ['id', 'user_id', 'userId', 'discord_id', 'discordId']),
        name: displayName(merged),
        username: pick(merged, ['username', 'name']),
        avatar: avatarUrl(merged),
        isCurrentUser: Boolean(
            input?.is_current_user || input?.isCurrentUser || input?.current_user || input?.currentUser ||
            input?.me || input?.self || input?.is_self || input?.isSelf || input?.local || input?.isLocal
        ),
        raw: input
    };
}

function isUsefulUser(user) {
    return !!(user && (user.id || user.avatar || (user.name && user.name !== 'Discord User')));
}

function setCurrentUser(input, source = 'unknown') {
    const normalized = normalizeAnyUser(input);
    if (!isUsefulUser(normalized)) return null;

    normalized.source = source;
    window.DD_CURRENT_USER = normalized;
    if (window.DD_DISCORD) window.DD_DISCORD.currentUser = normalized;

    try {
        if (normalized.id) localStorage.setItem('dd_last_discord_id', normalized.id);
        if (normalized.name && normalized.name !== 'Discord User') localStorage.setItem('dd_last_discord_name', normalized.name);
        if (normalized.avatar) localStorage.setItem('dd_last_discord_avatar', normalized.avatar);
    } catch {
    }

    window.dispatchEvent(new CustomEvent('discordIdentityChanged', {detail: normalized}));
    console.log('DD current user resolved:', normalized);
    return normalized;
}

function chooseCurrentUserFromParticipants(participants) {
    if (!Array.isArray(participants) || !participants.length) return null;
    const lastId = (() => {
        try {
            return localStorage.getItem('dd_last_discord_id') || '';
        } catch {
            return '';
        }
    })();
    return participants.find(p => p.isCurrentUser) ||
        (lastId ? participants.find(p => p.id === lastId) : null) ||
        participants[0] ||
        null;
}

function setLastKnownFallback() {
    try {
        const name = localStorage.getItem('dd_last_discord_name') || localStorage.getItem('cc_name') || '';
        const avatar = localStorage.getItem('dd_last_discord_avatar') || '';
        const id = localStorage.getItem('dd_last_discord_id') || '';
        if (name || avatar || id) return setCurrentUser({id, name, avatar}, 'last-known-fallback');
    } catch {
    }
    return null;
}

async function fetchParticipants(discordSdk) {
    try {
        const res = await withTimeout(discordSdk.commands.getInstanceConnectedParticipants(), 2500, 'participants timeout');
        console.log('DD raw participants:', res);
        return Array.isArray(res?.participants)
            ? res.participants.map(normalizeAnyUser)
            : (Array.isArray(res) ? res.map(normalizeAnyUser) : []);
    } catch (err) {
        console.warn('Could not fetch Discord participants:', err);
        return [];
    }
}

async function getAuthenticatedUser(discordSdk) {
    try {
        const auth = await withTimeout(discordSdk.commands.authorize({
            client_id: DISCORD_CLIENT_ID,
            response_type: 'code',
            state: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
            prompt: 'none',
            scope: ['identify']
        }), 6000, 'Discord authorize timeout');

        const code = auth?.code;
        if (!code) throw new Error('Discord did not return an OAuth code.');

        const tokenRes = await withTimeout(fetch('/api/discord-token', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code})
        }), 6000, 'Discord token endpoint timeout');

        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData?.access_token) {
            throw new Error(tokenData?.error || 'Could not exchange Discord OAuth code.');
        }

        const authRes = await withTimeout(
            discordSdk.commands.authenticate({access_token: tokenData.access_token}),
            6000,
            'Discord authenticate timeout'
        );

        return setCurrentUser(authRes?.user || authRes, 'authenticate');
    } catch (err) {
        console.warn('Discord profile auth failed:', err);
        window.DD_PROFILE_ERROR = err?.message || String(err);
        window.dispatchEvent(new CustomEvent('discordIdentityError', {detail: window.DD_PROFILE_ERROR}));
        return null;
    }
}

async function initDiscordActivity() {
    try {
        const discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
        window.DD_DISCORD_EARLY = {instanceId: discordSdk.instanceId};

        await discordSdk.ready();
        document.body.classList.add('discordActivity');

        window.DD_DISCORD = {
            enabled: true,
            sdk: discordSdk,
            instanceId: discordSdk.instanceId,
            channelId: discordSdk.channelId,
            guildId: discordSdk.guildId,
            platform: discordSdk.platform,
            participants: [],
            currentUser: null
        };

        window.DD_openInviteDialog = async function () {
            try {
                await discordSdk.commands.openInviteDialog();
                return {ok: true};
            } catch (err) {
                return {ok: false, error: err?.message || 'Could not open Discord invite dialog.'};
            }
        };

        window.DD_forceIdentityRefresh = async function () {
            const participants = await fetchParticipants(discordSdk);
            if (participants.length) {
                window.DD_PARTICIPANTS = participants;
                window.DD_DISCORD.participants = participants;
                const fallback = chooseCurrentUserFromParticipants(participants);
                if (fallback) setCurrentUser(fallback, 'participants-force-refresh');
                window.dispatchEvent(new CustomEvent('discordParticipantsChanged', {detail: participants}));
            }
            return window.DD_CURRENT_USER || window.DD_DISCORD.currentUser || null;
        };

        // Tell app.js the Discord SDK is alive immediately. Do not leave the lobby stuck
        // while profile/OAuth is still loading.
        window.dispatchEvent(new CustomEvent('discordActivityReady', {detail: window.DD_DISCORD}));

        const participants = await fetchParticipants(discordSdk);
        window.DD_PARTICIPANTS = participants;
        window.DD_DISCORD.participants = participants;

        const fallbackCurrentUser = chooseCurrentUserFromParticipants(participants);
        if (fallbackCurrentUser) setCurrentUser(fallbackCurrentUser, 'participants');
        else setLastKnownFallback();

        window.dispatchEvent(new CustomEvent('discordActivityReady', {detail: window.DD_DISCORD}));
        console.log('Discord Activity ready:', window.DD_DISCORD);

        getAuthenticatedUser(discordSdk).then(user => {
            if (user) {
                window.DD_DISCORD.currentUser = user;
                window.dispatchEvent(new CustomEvent('discordActivityReady', {detail: window.DD_DISCORD}));
            }
        });

        // Poll participants a few times because Discord can send the real participant list
        // slightly after ready() on desktop.
        [1200, 3000, 6000].forEach(delay => {
            setTimeout(async () => {
                const list = await fetchParticipants(discordSdk);
                if (list.length) {
                    window.DD_PARTICIPANTS = list;
                    window.DD_DISCORD.participants = list;
                    if (!window.DD_CURRENT_USER) {
                        const fallback = chooseCurrentUserFromParticipants(list);
                        if (fallback) setCurrentUser(fallback, 'participants-poll');
                    }
                    window.dispatchEvent(new CustomEvent('discordParticipantsChanged', {detail: list}));
                }
            }, delay);
        });
    } catch (err) {
        console.warn('Discord SDK not active. Normal website mode.', err);
        window.DD_DISCORD = {enabled: false};
        window.DD_openInviteDialog = null;
        window.DD_PROFILE_ERROR = err?.message || String(err);
        window.dispatchEvent(new CustomEvent('discordActivityReady', {detail: window.DD_DISCORD}));
        window.dispatchEvent(new CustomEvent('discordIdentityError', {detail: window.DD_PROFILE_ERROR}));
    }
}

initDiscordActivity();
