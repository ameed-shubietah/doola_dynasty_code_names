import { DiscordSDK, Events } from "https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm";

const DISCORD_CLIENT_ID = "1514895948197793893";

function pick(obj, keys){
  for(const key of keys){
    const value = obj?.[key];
    if(value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function avatarUrl(user){
  if(!user) return '';
  const direct = pick(user, [
    'avatar_url','avatarUrl','display_avatar_url','displayAvatarURL','display_avatar','displayAvatar',
    'image_url','imageUrl','image','icon_url','iconUrl','icon','photo','photoURL','photo_url'
  ]);
  if(direct && /^https?:\/\//i.test(String(direct))) return String(direct);

  const id = pick(user, ['id','user_id','userId','discord_id','discordId']);
  const avatar = pick(user, ['avatar','avatar_hash','avatarHash','avatar_id','avatarId']);
  if(avatar && /^https?:\/\//i.test(String(avatar))) return String(avatar);
  if(id && avatar){
    const ext = String(avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=256`;
  }
  if(id){
    try{
      const idx = Number((BigInt(id) >> 22n) % 6n);
      return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    }catch{}
  }
  const disc = pick(user, ['discriminator']);
  if(disc && disc !== '0') return `https://cdn.discordapp.com/embed/avatars/${Number(disc) % 5}.png`;
  return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function displayName(user){
  if(!user) return 'Discord User';
  return pick(user, [
    'global_name','globalName','display_name','displayName','nick','nickname','username','name'
  ]) || 'Discord User';
}

function normalizeParticipant(p){
  const user = p?.user || p?.member?.user || p;
  const merged = { ...(p || {}), ...(user || {}) };
  return {
    id: pick(merged, ['id','user_id','userId','discord_id','discordId']),
    name: displayName(merged),
    username: pick(merged, ['username','name']),
    avatar: avatarUrl(merged),
    raw: p
  };
}

function setCurrentUserFromParticipants(participants){
  const chosen = (participants || []).find(p => p?.id || p?.name || p?.avatar) || null;
  if(chosen){
    window.DD_CURRENT_USER = chosen;
    if(window.DD_DISCORD) window.DD_DISCORD.currentUser = chosen;
  }
  return chosen;
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

    // In most Discord Activity clients, the local/current participant is first.
    // If Discord returns the participant list a little late, the update event below refreshes it.
    const currentUser = setCurrentUserFromParticipants(participants);

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
    window.DD_CURRENT_USER = currentUser || window.DD_CURRENT_USER || null;
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
          setCurrentUserFromParticipants(window.DD_PARTICIPANTS);
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
