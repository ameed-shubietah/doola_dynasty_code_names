import { DiscordSDK, Events } from "https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm";

const DISCORD_CLIENT_ID = "1514895948197793893";

function avatarUrl(user){
  if(!user) return '';
  const id = user.id || user.user_id;
  const avatar = user.avatar || user.avatar_hash;
  if(id && avatar) return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=256`;
  if(id){
    try{
      const idx = Number((BigInt(id) >> 22n) % 6n);
      return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    }catch{}
  }
  return '';
}

function displayName(user){
  if(!user) return 'Discord User';
  return user.global_name || user.display_name || user.username || user.name || 'Discord User';
}

function normalizeParticipant(p){
  const user = p?.user || p;
  return {
    id: user?.id || p?.id || p?.user_id || '',
    name: displayName(user),
    username: user?.username || '',
    avatar: avatarUrl(user),
    raw: p
  };
}

async function initDiscordActivity() {
  try {
    const discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
    window.DD_DISCORD_EARLY = { instanceId: discordSdk.instanceId };

    await discordSdk.ready();
    document.body.classList.add("discordActivity");

    let participants = [];
    try {
      const res = await discordSdk.commands.getInstanceConnectedParticipants();
      participants = Array.isArray(res?.participants) ? res.participants.map(normalizeParticipant) : (Array.isArray(res) ? res.map(normalizeParticipant) : []);
    } catch (err) {
      console.warn("Could not fetch Discord participants", err);
    }

    // In most Discord Activity clients, the current user is the first local participant returned.
    // If Discord changes the shape, the game still falls back to the typed/local name.
    const currentUser = participants[0] || null;

    window.DD_DISCORD = {
      enabled: true,
      sdk: discordSdk,
      instanceId: discordSdk.instanceId,
      channelId: discordSdk.channelId,
      guildId: discordSdk.guildId,
      platform: discordSdk.platform,
      participants,
      currentUser
    };
    window.DD_CURRENT_USER = currentUser;
    window.DD_PARTICIPANTS = participants;

    window.DD_openInviteDialog = async function () {
      try {
        await discordSdk.commands.openInviteDialog();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || "Could not open Discord invite dialog." };
      }
    };

    async function refreshParticipants(payload){
      try {
        const list = Array.isArray(payload?.participants) ? payload.participants : (Array.isArray(payload) ? payload : []);
        if(list.length){
          window.DD_PARTICIPANTS = list.map(normalizeParticipant);
          window.dispatchEvent(new CustomEvent("discordParticipantsChanged", { detail: window.DD_PARTICIPANTS }));
        }
      } catch(err){ console.warn('participants update failed', err); }
    }
    try {
      if(Events?.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE){
        discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, refreshParticipants);
      }
    } catch(err){ console.warn('participant subscribe failed', err); }

    window.dispatchEvent(new CustomEvent("discordActivityReady", { detail: window.DD_DISCORD }));
    console.log("Discord Activity ready:", window.DD_DISCORD);
  } catch (err) {
    console.warn("Discord SDK not active. Normal website mode.", err);
    window.DD_DISCORD = { enabled: false };
    window.DD_openInviteDialog = null;
    window.dispatchEvent(new CustomEvent("discordActivityReady", { detail: window.DD_DISCORD }));
  }
}

initDiscordActivity();
