import {DiscordSDK} from "https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm";

const DISCORD_CLIENT_ID = "1514895948197793893";
const discordQuery = new URLSearchParams(window.location.search);
const queryInstanceId = discordQuery.get('instance_id') || discordQuery.get('instanceId') || discordQuery.get('activity_instance_id') || discordQuery.get('activityInstanceId') || '';
const queryChannelId = discordQuery.get('channel_id') || discordQuery.get('channelId') || '';
const queryGuildId = discordQuery.get('guild_id') || discordQuery.get('guildId') || '';

function avatarUrl(user) {
    if (!user?.id || !user?.avatar) return '';
    const extension = String(user.avatar).startsWith('a_') ? 'gif' : 'webp';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=256`;
}

function normalizedUser(user) {
    if (!user?.id) return null;
    return {
        id: String(user.id),
        name: String(user.global_name || user.display_name || user.username || 'Discord User'),
        username: String(user.username || ''),
        avatar: avatarUrl(user)
    };
}

function cacheUser(user) {
    if (!user?.id) return;
    window.DD_CURRENT_USER = user;
    try {
        localStorage.dd_last_discord_id = user.id;
        localStorage.dd_last_discord_name = user.name || '';
        localStorage.dd_last_discord_avatar = user.avatar || '';
    } catch {
    }
}

async function authenticateDiscordUser(discordSdk) {
    const {code} = await discordSdk.commands.authorize({
        client_id: DISCORD_CLIENT_ID,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify']
    });
    if (!code) throw new Error('Discord authorization did not return a code.');

    const tokenResponse = await fetch('/api/discord-token', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code})
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
        throw new Error(tokenData.error || 'Discord token exchange failed.');
    }

    const auth = await discordSdk.commands.authenticate({access_token: tokenData.access_token});
    if (!auth?.user) throw new Error('Discord authentication did not return a user.');
    return normalizedUser(auth.user);
}

async function initDiscordActivity() {
    try {
        const discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
        window.DD_DISCORD_EARLY = {
            instanceId: discordSdk.instanceId || queryInstanceId,
            channelId: discordSdk.channelId || queryChannelId,
            guildId: discordSdk.guildId || queryGuildId
        };

        await discordSdk.ready();
        document.body.classList.add('discordActivity');

        let currentUser = null;
        let authError = '';
        try {
            currentUser = await authenticateDiscordUser(discordSdk);
            cacheUser(currentUser);
        } catch (err) {
            authError = err?.message || String(err);
        }

        window.DD_DISCORD = {
            enabled: true,
            sdk: discordSdk,
            instanceId: discordSdk.instanceId || queryInstanceId,
            channelId: discordSdk.channelId || queryChannelId,
            guildId: discordSdk.guildId || queryGuildId,
            platform: discordSdk.platform,
            participants: currentUser ? [{...currentUser, isCurrentUser: true}] : [],
            currentUser,
            authError
        };

        window.DD_PARTICIPANTS = window.DD_DISCORD.participants;
        window.DD_openInviteDialog = async function () {
            try {
                await discordSdk.commands.openInviteDialog();
                return {ok: true};
            } catch (err) {
                return {ok: false, error: err?.message || 'Could not open Discord invite dialog.'};
            }
        };

        window.dispatchEvent(new CustomEvent('discordActivityReady', {detail: window.DD_DISCORD}));
        if (currentUser) window.dispatchEvent(new CustomEvent('discordIdentityChanged', {detail: currentUser}));
    } catch (err) {
        window.DD_DISCORD = {enabled: false, authError: err?.message || String(err)};
        window.DD_openInviteDialog = null;
        window.DD_PROFILE_ERROR = err?.message || String(err);
        window.dispatchEvent(new CustomEvent('discordActivityReady', {detail: window.DD_DISCORD}));
    }
}

initDiscordActivity();
