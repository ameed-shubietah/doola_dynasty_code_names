import { DiscordSDK, Events } from "https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm";

const DISCORD_CLIENT_ID = "1514895948197793893";

function pick(obj, keys){
  for(const key of keys){
    const value = obj?.[key];
    if(value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function withTimeout(promise, ms, label='Timed out'){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))
  ]);
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
  return '';
}

function displayName(user){
  if(!user) return 'Discord User';
  return pick(user, [
    'global_name','globalName','display_name','displayName','nick','nickname','username','name'
  ]) || 'Discord User';
}

function normalizeUser(user){
  const u = user?.user || user?.member?.user || user || {};
  const member = user?.member || {};
  const merged = { ...(user || {}), ...(member || {}), ...(u || {}) };
  const id = pick(merged, ['id','user_id','userId','discord_id','discordId']);
  return {
    id,
    name: displayName(merged),
    username: pick(merged, ['username','name']),
    avatar: avatarUrl(merged),
    raw: user
  };
}

function normalizeParticipant(p){
  const user = p?.user || p?.member?.user || p;
  const member = p?.member || {};
  const merged = { ...(p || {}), ...(member || {}), ...(user || {}) };
  return {
    id: pick(merged, ['id','user_id','userId','discord_id','discordId']),
    name: displayName(merged),
    username: pick(merged, ['username','name']),
    avatar: avatarUrl(merged),
    isCurrentUser: Boolean(
      p?.is_current_user || p?.isCurrentUser || p?.current_user || p?.currentUser ||
      p?.me || p?.self || p?.is_self || p?.isSelf || p?.local || p?.isLocal
    ),
    raw: p
  };
}

function setCurrentUser(user, source='unknown'){
  const normalized = normalizeUser(user);
  if(normalized?.id || (normalized?.name && normalized.name !== 'Discord User') || normalized?.avatar){
    normalized.source = source;
    window.DD_CURRENT_USER = normalized;
    if(window.DD_DISCORD) window.DD_DISCORD.currentUser = normalized;
    try { localStorage.setItem('dd_last_discord_id', normalized.id || ''); } catch {}
    window.dispatchEvent(new CustomEvent('discordIdentityChanged', { detail: normalized }));
    console.log('DD current user resolved:', normalized);
    return normalized;
  }
  return null;
}

function chooseCurrentUserFromParticipants(participants){
  if(!Array.isArray(participants) || !participants.length) return null;
  const lastId = (() => { try { return localStorage.getItem('dd_last_discord_id') || ''; } catch { return ''; } })();
  return participants.find(p => p.isCurrentUser) ||
    (lastId ? participants.find(p => p.id === lastId) : null) ||
    participants[0] ||
    null;
}

async function fetchParticipants(discordSdk){
  try {
    const res = await withTimeout(discordSdk.commands.getInstanceConnectedParticipants(), 2500, 'participants timeout');
    console.log('DD raw participants:', res);
    return Array.isArray(res?.participants) ? res.participants.map(normalizeParticipant) : (Array.isArray(res) ? res.map(normalizeParticipant) : []);
  } catch (err) {
    console.warn('Could not fetch Discord participants', err);
    return [];
  }
}

async function getAuthenticatedUser(discordSdk){
  try {
    const auth = await withTimeout(discordSdk.commands.authorize({
      client_id: DISCORD_CLIENT_ID,
      response_type: 'code',
      state: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      prompt: 'none',
      scope: ['identify']
    }), 5000, 'Discord authorize timeout');

    const code = auth?.code;
    if(!code) throw new Error('Discord did not return an OAuth code.');

    const tokenRes = await withTimeout(fetch('/api/discord-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    }), 5000, 'Discord token endpoint timeout');
    const tokenData = await tokenRes.json().catch(() => ({}));
    if(!tokenRes.ok || !tokenData?.access_token){
      throw new Error(tokenData?.error || 'Could not exchange Discord OAuth code.');
    }

    const authRes = await withTimeout(discordSdk.commands.authenticate({ access_token: tokenData.access_token }), 5000, 'Discord authenticate timeout');
    const user = authRes?.user || authRes;
    return setCurrentUser(user, 'authenticate');
  } catch (err) {
    console.warn('Discord profile auth failed:', err);
    window.DD_PROFILE_ERROR = err?.message || String(err);
    window.dispatchEvent(new CustomEvent('discordIdentityError', { detail: window.DD_PROFILE_ERROR }));
    return null;
  }
}

async function initDiscordActivity() {
  try {
    const discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
    window.DD_DISCORD_EARLY = { instanceId: discordSdk.instanceId };

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
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || 'Could not open Discord invite dialog.' };
      }
    };

    // Do NOT block the game on OAuth. First use Discord's participant list, then
    // silently replace it with the authenticated user when/if OAuth succeeds.
    const participants = await fetchParticipants(discordSdk);
    window.DD_PARTICIPANTS = participants;
    window.DD_DISCORD.participants = participants;

    const fallbackCurrentUser = chooseCurrentUserFromParticipants(participants);
    if(fallbackCurrentUser) setCurrentUser(fallbackCurrentUser, 'participants');

    window.dispatchEvent(new CustomEvent('discordActivityReady', { detail: window.DD_DISCORD }));
    console.log('Discord Activity ready:', window.DD_DISCORD);

    getAuthenticatedUser(discordSdk).then(user => {
      if(user){
        window.DD_DISCORD.currentUser = user;
        window.dispatchEvent(new CustomEvent('discordActivityReady', { detail: window.DD_DISCORD }));
      }
    });

    async function refreshParticipants(payload){
      try {
        const list = Array.isArray(payload?.participants) ? payload.participants : (Array.isArray(payload) ? payload : []);
        if(list.length){
          window.DD_PARTICIPANTS = list.map(normalizeParticipant);
          if(window.DD_DISCORD) window.DD_DISCORD.participants = window.DD_PARTICIPANTS;
          if(!window.DD_CURRENT_USER){
            const fallback = chooseCurrentUserFromParticipants(window.DD_PARTICIPANTS);
            if(fallback) setCurrentUser(fallback, 'participants-update');
          }
          window.dispatchEvent(new CustomEvent('discordParticipantsChanged', { detail: window.DD_PARTICIPANTS }));
        }
      } catch(err){ console.warn('participants update failed', err); }
    }
    try {
      if(Events?.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE){
        discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, refreshParticipants);
      }
    } catch(err){ console.warn('participant subscribe failed', err); }
  } catch (err) {
    console.warn('Discord SDK not active. Normal website mode.', err);
    window.DD_DISCORD = { enabled: false };
    window.DD_openInviteDialog = null;
    window.dispatchEvent(new CustomEvent('discordActivityReady', { detail: window.DD_DISCORD }));
  }
}

initDiscordActivity();
