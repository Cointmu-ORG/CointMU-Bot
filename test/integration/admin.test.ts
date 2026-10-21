import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPLY_CLAIM_DISABLED } from '../../src/commands/public-handlers.js';
import { REPLY_ADMIN_ONLY, REPLY_STATS_DENIED } from '../../src/commands/replies.js';
import {
  claimAdmin,
  dm,
  GROUP_ID,
  inGroup,
  OWNER_ID,
  STRANGER_ID,
  TOKEN_ONLY,
} from '../support/chat.js';
import { Harness } from '../support/harness.js';

const ENV_ADMIN = 42;
const CONFIG_COMMANDS = [
  '/setchat',
  '/unsetchat',
  '/setalert',
  '/unsetalert',
  '/chats',
  `/addadmin ${STRANGER_ID}`,
  `/removeadmin ${OWNER_ID}`,
];

describe('admins and access control (mock Telegram)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = new Harness();
    await h.start();
  });

  afterEach(async () => {
    await h.close();
  });

  it('refuses every configuration command from a non-admin: silent in groups, ⛔ in private', async () => {
    const app = h.createApp({ ...TOKEN_ONLY, commandCooldownMs: 0 });
    await claimAdmin(h, app);

    for (const command of CONFIG_COMMANDS) {
      expect(await inGroup(h, app, STRANGER_ID, command)).toEqual([]);
      expect(await dm(h, app, STRANGER_ID, command)).toEqual([REPLY_ADMIN_ONLY]);
    }
    const settings = app.components.botSettings;
    expect(settings.announceDestination()).toBeNull();
    expect(settings.alertDestination()).toBeNull();
    expect(settings.adminIds()).toEqual([String(OWNER_ID)]);
  });

  it('adds and removes admins, protecting env admins', async () => {
    const app = h.createApp({ ...TOKEN_ONLY, allowedUserIds: [String(ENV_ADMIN)] });

    expect((await dm(h, app, ENV_ADMIN, `/addadmin ${OWNER_ID}`))[0]).toContain('sekarang admin');
    expect((await dm(h, app, OWNER_ID, '/chats'))[0]).toContain(`<code>${ENV_ADMIN}</code> (env)`);
    expect((await dm(h, app, OWNER_ID, `/removeadmin ${ENV_ADMIN}`))[0]).toContain(
      'hapus lewat env',
    );
    expect((await dm(h, app, ENV_ADMIN, `/removeadmin ${OWNER_ID}`))[0]).toContain(
      'bukan admin lagi',
    );
    expect(app.components.botSettings.adminIds()).toEqual([String(ENV_ADMIN)]);
  });

  it('refuses to remove the last admin', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await claimAdmin(h, app);

    const [reply] = await dm(h, app, OWNER_ID, `/removeadmin ${OWNER_ID}`);

    expect(reply).toContain('admin terakhir');
    expect(app.components.botSettings.adminIds()).toEqual([String(OWNER_ID)]);
  });

  it('disables the claim once any admin exists (env or claimed)', async () => {
    const withEnv = h.createApp({ ...TOKEN_ONLY, allowedUserIds: [String(ENV_ADMIN)] });
    withEnv.components.claim.issueIfNeeded();
    expect(h.claimCodes()).toEqual([]);
    expect(await dm(h, withEnv, OWNER_ID, '/claim whatever')).toEqual([REPLY_CLAIM_DISABLED]);
    await h.stopApp(withEnv);

    const tokenOnly = h.createApp(TOKEN_ONLY);
    await claimAdmin(h, tokenOnly);
    const [code] = h.claimCodes();
    h.clock += 5_000;
    expect(await dm(h, tokenOnly, STRANGER_ID, `/claim ${code ?? ''}`)).toEqual([
      REPLY_CLAIM_DISABLED,
    ]);
  });

  it('allows stats for anyone in the announcement chat with a per-user cooldown', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await app.components.collector.tick();
    await claimAdmin(h, app);
    await inGroup(h, app, OWNER_ID, '/setchat');

    expect((await inGroup(h, app, STRANGER_ID, '/status'))[0]).toContain('Status CointMU');
    expect(await inGroup(h, app, STRANGER_ID, '/last 2')).toEqual([]);
    h.clock += 5_000;
    expect((await inGroup(h, app, STRANGER_ID, '/last 2'))[0]).toContain('2 block terakhir');
    expect((await inGroup(h, app, OWNER_ID, '/top'))[0]).toContain('Top wallet');
    // The same view in the same chat within DUPLICATE_WINDOW_SECONDS is not resent.
    expect(await inGroup(h, app, OWNER_ID, '/top')).toEqual([]);
    h.clock += 10_000;
    expect((await inGroup(h, app, OWNER_ID, '/top'))[0]).toContain('Top wallet');
  });

  it('allows stats in private chats only for admins', async () => {
    const app = h.createApp(TOKEN_ONLY);
    await app.components.collector.tick();
    await claimAdmin(h, app);

    expect(await dm(h, app, STRANGER_ID, '/status')).toEqual([REPLY_STATS_DENIED]);
    expect((await dm(h, app, OWNER_ID, '/status'))[0]).toContain('Status CointMU');
    h.clock += 5_000;
    expect(await inGroup(h, app, STRANGER_ID, '/status', GROUP_ID - 1)).toEqual([
      REPLY_STATS_DENIED,
    ]);
  });
});
