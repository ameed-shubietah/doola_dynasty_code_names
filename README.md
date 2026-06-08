# Doola's Dynasty Code Names

A real-time browser party game inspired by Codenames, built with Node.js, Express, and Socket.IO.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Invite links

Create a room, then click **Generate Invite**. The invite URL includes the room code, for example:

```text
https://your-site.com/?room=ABCDE
```

When a player opens the invite link, the room code and invite box are filled automatically. They only need to choose their name, team, role, and character.

## Deploy

Use GitHub for the code and Render/Railway for hosting, because the game needs a Node.js server and WebSocket support.

Render settings:

```text
Build Command: npm install
Start Command: npm start
```


Latest adjustments: per-card confirm buttons, multi-card marking by operatives, finished games reveal all card origins, and the landing invite-link field was removed.
