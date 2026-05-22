// hello-world: minimal example plugin demonstrating the v0.30 plugin API.
//
// This file runs inside a node:vm sandbox provided by apps/bot. It has no
// access to fs, no access to the bot token, and no access to discord.js
// objects — only the JSON payloads documented in PLUGINS.md.
//
// To enable a hook, declare it in plugin.json's "hooks" field AND export a
// function with the same name (either via `module.exports` or as a top-level
// `function` declaration in this file).

function onMessage(payload) {
  // payload: { id, content, authorId, authorBot, guildId, channelId, createdTimestamp }
  console.log(
    'hello from plugin — message from',
    payload.authorId,
    'in guild',
    payload.guildId,
    ':',
    JSON.stringify(payload.content).slice(0, 80),
  );
}

function onMemberJoin(payload) {
  // payload: { userId, username, guildId, joinedTimestamp }
  console.log('hello from plugin — new member', payload.username, 'joined', payload.guildId);
}

module.exports = { onMessage, onMemberJoin };
