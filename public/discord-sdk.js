import {DiscordSDK} from "https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm";

const DISCORD_CLIENT_ID = "1514895948197793893";
const discordQuery = new URLSearchParams(window.location.search);
const queryInstanceId = discordQuery.get('instance_id') || discordQuery.get('instanceId') || discordQuery.get('activity_instance_id') || discordQuery.get('activityInstanceId') || '';
const queryChannelId = discordQuery.get('channel_id') || discordQuery.get('channelId') || '';
const queryGuildId = discordQuery.get('guild_id') || discordQuery.get('guildId') || '';

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

        window.DD_DISCORD = {
            enabled: true,
            sdk: discordSdk,
            instanceId: discordSdk.instanceId || queryInstanceId,
            channelId: discordSdk.channelId || queryChannelId,
            guildId: discordSdk.guildId || queryGuildId,
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


        window.dispatchEvent(new CustomEvent('discordActivityReady', {detail: window.DD_DISCORD}));
        console.log('Discord Activity ready without profile name fetching:', window.DD_DISCORD);
    } catch (err) {
        console.warn('Discord SDK not active. Normal website mode.', err);
        window.DD_DISCORD = {enabled: false};
        window.DD_openInviteDialog = null;
        window.DD_PROFILE_ERROR = err?.message || String(err);
        window.dispatchEvent(new CustomEvent('discordActivityReady', {detail: window.DD_DISCORD}));
    }
}

initDiscordActivity();
