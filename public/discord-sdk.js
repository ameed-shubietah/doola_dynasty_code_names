import { DiscordSDK } from "https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm";

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
  if (!user) return '';

  const direct = pick(user, [
    'avatar_url', 'avatarUrl', 'display_avatar_url', 'displayAvatarURL',
    'display_avatar', 'displayAvatar', 'image_url', 'imageUrl', 'image',
    'icon_url', 'iconUrl', 'icon', 'photo', 'photoURL', 'photo_url'
  ]);
  if (direct && /^https?:\/\//i.test(String(direct))) return String(direct);

  const id = pick(user, ['id', 'user_id', 'userId', 'discord_id', 'discordId']);
  const avatar = pick(user, ['avatar', 'avatar_hash', 'avatarHash', 'avatar_id', 'avatarId']);

  if (avatar && /^https?:\/\//i.test(String(avatar))) return String(avatar);

  if (id && avatar && avatar !== 'null') {
    const ext = String(avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=256`;
  }

  const discriminator = pick(user, ['discriminator']);
  if (discriminator && discriminator !== '0') {
    return `https://cdn.discordapp.com/embed/avatars/${Number(discriminator) % 5}.png`;
  }

  if (id) {
    try {
      const idx = Number((BigInt(id) >> 22n) % 6n);
      return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    } catch {}
  }

  return '';
}

function displayName(user) {
  if (!user) return 'Discord User';
  return pick(user, [
    'global_name', 'globalName', 'display_name', 'displayName',
    'nick', 'nickname', 'username', 'name'
  ]) || 'Discord User';
}

function normalizeAnyUser(input) {
  const user = input?.user || input?.member?.user || input?.participant?.user || input || {};
  const member = input?.member || input?.participant?.member || {};
  const merged = { ...(input || {}), ...(member || {}), ...(user || {}) };

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
  } catch {}

  window.dispatchEvent(new CustomEvent('discordIdentityChanged', { detail: normalized }));
  console.log('DD current user resolved:', normalized);
  return normalized;
}

function chooseCurrentUserFromParticipants(participants) {
  if (!Array.isArray(participants) || !participants.length) return null;
  const lastId = (() => { try { return localStorage.getItem('dd_last_discord_id') || ''; } catch { return ''; } })();
  return participants.find(p => p.isCurrentUser) ||
    (lastId ? participants.find(p => p.id === lastId) : null) ||
    participants[0] ||
    null;
}

function setLastKnownFallback() {
  try {
    const name = localStorage.getItem('dd_last_discord_name') || '';
    const avatar = localStorage.getItem('dd_last_discord_avatar') || '';
    const id = localStorage.getItem('dd_last_discord_id') || '';
    if (name || avatar || id) return setCurrentUser({ id, name, avatar }, 'last-known-fallback');
  } catch {}
  return null;
}

function setQueryParamFallback() {
  try {
    const q = new URLSearchParams(location.search);
    const id = q.get('user_id') || q.get('userId') || q.get('discord_id') || q.get('discordId') || '';
    const name = q.get('global_name') || q.get('globalName') || q.get('display_name') || q.get('displayName') || q.get('username') || q.get('name') || '';
    const avatar = q.get('avatar_url') || q.get('avatarUrl') || q.get('avatar') || '';
    if (id || name || avatar) return setCurrentUser({ id, name, avatar }, 'query-fallback');
  } catch {}
  return null;
}

function mergeBetterUser(primary, secondary) {
  const a = primary ? normalizeAnyUser(primary) : null;
  const b = secondary ? normalizeAnyUser(secondary) : null;
  if (!a) return b;
  if (!b) return a;
  return {
    ...a,
    id: a.id || b.id,
    name: (a.name && a.name !== 'Discord User') ? a.name : b.name,
    username: a.username || b.username,
    avatar: a.avatar || b.avatar,
    isCurrentUser: a.isCurrentUser || b.isCurrentUser,
    raw: { primary, secondary }
  };
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
  let serverUser = null;
  try {
    const auth = await withTimeout(discordSdk.commands.authorize({
      client_id: DISCORD_CLIENT_ID,
      response_type: 'code',
      state: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      prompt: 'none',
      scope: ['identify']
    }), 8000, 'Discord authorize timeout');

    const code = auth?.code;
    if (!code) throw new Error('Discord did not return an OAuth code.');

    const tokenRes = await withTimeout(fetch('/api/discord-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    }), 8000, 'Discord token endpoint timeout');

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData?.access_token) {
      throw new Error(tokenData?.error || 'Could not exchange Discord OAuth code.');
    }

    // The server-side /users/@me response is the most reliable source for the real
    // display name and avatar URL. Set it immediately, before SDK authenticate.
    if (tokenData.user) {
      serverUser = setCurrentUser(tokenData.user, 'server-users-me');
    }

    try {
      const authRes = await withTimeout(
        discordSdk.commands.authenticate({ access_token: tokenData.access_token }),
        8000,
        'Discord authenticate timeout'
      );
      const sdkUser = normalizeAnyUser(authRes?.user || authRes);
      const merged = mergeBetterUser(sdkUser, serverUser || tokenData.user);
      return setCurrentUser(merged, 'authenticate+server');
    } catch (authErr) {
      // If authenticate fails but /users/@me worked, keep the real name/avatar.
      if (serverUser) return serverUser;
      throw authErr;
    }
  } catch (err) {
    console.warn('Discord profile auth failed:', err);
    window.DD_PROFILE_ERROR = err?.message || String(err);
    // Do not keep the UI in a permanent loading state if we already have a partial user.
    if (window.DD_CURRENT_USER) {
      window.dispatchEvent(new CustomEvent('discordIdentityChanged', { detail: window.DD_CURRENT_USER }));
    } else {
      window.dispatchEvent(new CustomEvent('discordIdentityError', { detail: window.DD_PROFILE_ERROR }));
    }
    return window.DD_CURRENT_USER || null;
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

    setQueryParamFallback();

    window.DD_openInviteDialog = async function () {
      try {
        await discordSdk.commands.openInviteDialog();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || 'Could not open Discord invite dialog.' };
      }
    };

    // Tell app.js the Discord SDK is alive immediately. Do not leave the lobby stuck
    // while profile/OAuth is still loading.
    window.dispatchEvent(new CustomEvent('discordActivityReady', { detail: window.DD_DISCORD }));

    const participants = await fetchParticipants(discordSdk);
    window.DD_PARTICIPANTS = participants;
    window.DD_DISCORD.participants = participants;

    const fallbackCurrentUser = chooseCurrentUserFromParticipants(participants);
    if (fallbackCurrentUser) setCurrentUser(fallbackCurrentUser, 'participants');
    else setLastKnownFallback();

    window.dispatchEvent(new CustomEvent('discordActivityReady', { detail: window.DD_DISCORD }));
    console.log('Discord Activity ready:', window.DD_DISCORD);

    getAuthenticatedUser(discordSdk).then(user => {
      if (user) {
        window.DD_DISCORD.currentUser = user;
        window.dispatchEvent(new CustomEvent('discordActivityReady', { detail: window.DD_DISCORD }));
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
          window.dispatchEvent(new CustomEvent('discordParticipantsChanged', { detail: list }));
        }
      }, delay);
    });
  } catch (err) {
    console.warn('Discord SDK not active. Normal website mode.', err);
    window.DD_DISCORD = { enabled: false };
    window.DD_openInviteDialog = null;
    window.DD_PROFILE_ERROR = err?.message || String(err);
    window.dispatchEvent(new CustomEvent('discordActivityReady', { detail: window.DD_DISCORD }));
    window.dispatchEvent(new CustomEvent('discordIdentityError', { detail: window.DD_PROFILE_ERROR }));
  }
}

initDiscordActivity();
