import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

const playerProfile = table(
  { public: false },
  {
    accountId: t.string().primaryKey(),
    playerId: t.string(),
    displayName: t.string(),
    revision: t.u64(),
  }
);

// Only these three fields may be exposed to a client. The wallet mapping stays
// in playerProfile, which is private even when clients subscribe here.
const playerDirectory = table(
  { public: true },
  {
    playerId: t.string().primaryKey(),
    displayName: t.string(),
    revision: t.u64(),
  }
);

const spacetimedb = schema(
  { playerProfile, playerDirectory },
  {
    env: {
      BRIDGE_ISSUER: t.string(),
      BRIDGE_AUDIENCE: t.string(),
      BRIDGE_SUBJECT: t.string(),
    },
  }
);
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function requireBridge(ctx: Ctx) {
  const jwt = ctx.senderAuth.jwt;
  if (!ctx.env.BRIDGE_ISSUER || !ctx.env.BRIDGE_AUDIENCE ||
    !ctx.env.BRIDGE_SUBJECT || jwt == null ||
    jwt.issuer !== ctx.env.BRIDGE_ISSUER ||
    !jwt.audience.includes(ctx.env.BRIDGE_AUDIENCE) ||
    jwt.subject !== ctx.env.BRIDGE_SUBJECT) {
    throw new SenderError('Only the MineMine bridge may call this module');
  }
}

export const upsertProfile = spacetimedb.reducer(
  { accountId: t.string(), playerId: t.string(), displayName: t.string(), revision: t.u64() },
  (ctx, { accountId, playerId, displayName, revision }) => {
    requireBridge(ctx);
    if (!/^0x[0-9a-f]{40}$/.test(accountId)) {
      throw new SenderError('Account ID must be a lowercase EVM address');
    }
    if (!/^w_[a-f0-9]{17}$/.test(playerId)) {
      throw new SenderError('Invalid stable player ID');
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(displayName) ||
      displayName !== displayName.trim() ||
      [...displayName].length < 1 || [...displayName].length > 255 ||
      /[\u0000-\u001f\u007f]/.test(displayName)) {
      throw new SenderError('Invalid display name');
    }
    if (revision < 1n) throw new SenderError('Revision must be positive');

    const existing = ctx.db.playerProfile.accountId.find(accountId);
    if (existing) {
      if (existing.playerId !== playerId) {
        throw new SenderError('Stable player ID cannot change');
      }
      const publicRow = ctx.db.playerDirectory.playerId.find(playerId);
      if (!publicRow || publicRow.revision !== existing.revision ||
        publicRow.displayName !== existing.displayName) {
        throw new SenderError('Public profile directory is out of sync');
      }
      if (revision < existing.revision) return;
      if (revision === existing.revision) {
        if (displayName !== existing.displayName) {
          throw new SenderError('Conflicting profile revision');
        }
        return;
      }
      existing.displayName = displayName;
      existing.revision = revision;
      ctx.db.playerProfile.accountId.update(existing);
      publicRow.displayName = displayName;
      publicRow.revision = revision;
      ctx.db.playerDirectory.playerId.update(publicRow);
      return;
    }
    if (ctx.db.playerDirectory.playerId.find(playerId)) {
      throw new SenderError('Stable player ID is already assigned');
    }
    ctx.db.playerProfile.insert({ accountId, playerId, displayName, revision });
    ctx.db.playerDirectory.insert({ playerId, displayName, revision });
  }
);
