import { DiscordSDK, Permissions, PermissionUtils } from "https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm";

const DISCORD_CLIENT_ID = "1514895948197793893";

async function initDiscordActivity() {
  try {
    const discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);

    await discordSdk.ready();

    window.DD_DISCORD = {
      enabled: true,
      sdk: discordSdk,
      instanceId: discordSdk.instanceId,
      channelId: discordSdk.channelId,
      guildId: discordSdk.guildId,
      platform: discordSdk.platform
    };

    window.DD_openInviteDialog = async function () {
      try {
        const { permissions } = await discordSdk.commands.getChannelPermissions();
        if (PermissionUtils.can(Permissions.CREATE_INSTANT_INVITE, permissions)) {
          await discordSdk.commands.openInviteDialog();
          return { ok: true };
        }
        return { ok: false, error: 'You do not have permission to create Discord invites in this channel.' };
      } catch (err) {
        try {
          await discordSdk.commands.openInviteDialog();
          return { ok: true };
        } catch (err2) {
          return { ok: false, error: err2?.message || err?.message || 'Could not open Discord invite dialog.' };
        }
      }
    };

    window.dispatchEvent(new CustomEvent("discordActivityReady", {
      detail: window.DD_DISCORD
    }));

    console.log("Discord Activity ready:", window.DD_DISCORD);
  } catch (err) {
    console.warn("Discord SDK not active. Normal website mode.", err);

    window.DD_DISCORD = {
      enabled: false
    };
    window.DD_openInviteDialog = null;

    window.dispatchEvent(new CustomEvent("discordActivityReady", {
      detail: window.DD_DISCORD
    }));
  }
}

initDiscordActivity();