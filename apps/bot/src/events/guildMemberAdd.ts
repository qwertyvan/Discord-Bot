import { AttachmentBuilder, Events, type Client, type GuildMember } from 'discord.js';
import { log } from '../logger.js';
import { api, ApiError } from '../api-client.js';
import { dispatchOnMemberJoin } from '../plugins/index.js';
import { generateImageCaptcha, generateMathChallenge } from '../util/captcha.js';
import { computeRiskScore } from '../util/risk-score.js';
import {
  bumpBlocked,
  clearLockdown,
  getActiveLockdown,
  recordJoin,
  setActiveLockdown,
} from '../util/anti-raid-state.js';
import type { AntiRaidConfig, CaptchaKind } from '@discord-bot/shared';

const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const JOIN_SURGE_FACTOR = 0.75;

export function registerGuildMemberAddPluginBridge(client: Client): void {
  client.on(Events.GuildMemberAdd, (member) => {
    dispatchOnMemberJoin(member);
  });
}

export function registerGuildMemberAdd(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    const guildId = member.guild.id;

    let cfg: AntiRaidConfig | null;
    try {
      cfg = await api.getAntiRaidConfig(guildId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return;
      log.warn('anti-raid: getAntiRaidConfig failed', { guildId, err: String(err) });
      return;
    }
    if (!cfg.enabled) return;

    const jpm = recordJoin(guildId);
    const active = getActiveLockdown(guildId);

    if (active) {
      await kickRaider(member, `Lockdown active (${active.id.slice(0, 8)})`);
      bumpBlocked(guildId);
      return;
    }

    if (jpm > cfg.joinsPerMinuteThreshold) {
      try {
        const ev = await api.startLockdown(guildId, `auto: ${jpm} joins/min`);
        if (!ev.endedAt) {
          setActiveLockdown({
            id: ev.id,
            guildId,
            expiresAt: Date.now() + cfg.lockdownDurationMin * 60_000,
            blocked: 0,
          });
          log.warn('anti-raid: lockdown opened', {
            guildId,
            jpm,
            threshold: cfg.joinsPerMinuteThreshold,
            id: ev.id,
          });
        }
      } catch (err) {
        log.warn('anti-raid: startLockdown failed', { guildId, err: String(err) });
      }
      await kickRaider(member, `Anti-raid lockdown: ${jpm} joins/min`);
      bumpBlocked(guildId);
      return;
    }

    if (!cfg.captchaRequired) return;

    const joinSurge =
      jpm >= Math.max(2, Math.floor(cfg.joinsPerMinuteThreshold * JOIN_SURGE_FACTOR));
    const risk = computeRiskScore(member, { joinSurge });
    if (risk.score < cfg.riskScoreThreshold) return;

    log.info('anti-raid: issuing captcha', {
      guildId,
      userId: member.id,
      risk: risk.score,
      reasons: risk.reasons,
    });

    if (cfg.unverifiedRoleId) {
      await member.roles.add(cfg.unverifiedRoleId, 'Anti-raid: awaiting captcha').catch((err) => {
        log.warn('anti-raid: unverified role add failed', {
          guildId,
          userId: member.id,
          err: String(err),
        });
      });
    }

    await issueChallenge(member, cfg.captchaKind);
  });
}

async function kickRaider(member: GuildMember, reason: string): Promise<void> {
  try {
    if (member.kickable) {
      await member.kick(reason);
    }
  } catch (err) {
    log.warn('anti-raid: kick failed', {
      guildId: member.guild.id,
      userId: member.id,
      err: String(err),
    });
  }
}

export async function issueChallenge(member: GuildMember, kind: CaptchaKind): Promise<boolean> {
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();

  if (kind === 'image') {
    const challenge = generateImageCaptcha();
    try {
      await api.createPendingVerification(member.guild.id, {
        userId: member.id,
        challengeKind: 'image',
        challenge: '[image]',
        answer: challenge.answer,
        expiresAt,
      });
    } catch (err) {
      log.warn('anti-raid: createPendingVerification (image) failed', {
        guildId: member.guild.id,
        err: String(err),
      });
      return false;
    }
    const attachment = new AttachmentBuilder(challenge.pngBuffer, { name: 'captcha.png' });
    await member
      .send({
        content: [
          `Welcome to **${member.guild.name}**!`,
          'To finish joining, please solve the captcha below by running',
          '`/verify <answer>` here in DMs. You have 10 minutes and 3 attempts.',
        ].join('\n'),
        files: [attachment],
      })
      .catch((err) => {
        log.info('anti-raid: captcha DM failed (closed DMs?)', {
          userId: member.id,
          err: String(err),
        });
      });
    return true;
  }

  const math = generateMathChallenge();
  try {
    await api.createPendingVerification(member.guild.id, {
      userId: member.id,
      challengeKind: 'math',
      challenge: math.question,
      answer: math.answer,
      expiresAt,
    });
  } catch (err) {
    log.warn('anti-raid: createPendingVerification (math) failed', {
      guildId: member.guild.id,
      err: String(err),
    });
    return false;
  }
  await member
    .send({
      content: [
        `Welcome to **${member.guild.name}**!`,
        `To finish joining, please solve this and run \`/verify <answer>\` here in DMs:`,
        `**${math.question}**`,
        '_You have 10 minutes and 3 attempts._',
      ].join('\n'),
    })
    .catch((err) => {
      log.info('anti-raid: captcha DM failed (closed DMs?)', {
        userId: member.id,
        err: String(err),
      });
    });
  return true;
}

export { clearLockdown };
