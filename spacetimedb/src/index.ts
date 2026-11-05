import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

const playerProfile = table(
  { public: false },
  {
    accountId: t.string().primaryKey(),
    displayName: t.string(),
    revision: t.u64(),
  }
);

const spacetimedb = schema(
  { playerProfile },
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

// A connection guard is useful for subscriptions; the reducer repeats it because
// calls can also arrive over HTTP without a persistent WebSocket connection.
export const onConnect = spacetimedb.clientConnected(ctx => {
  requireBridge(ctx);
});

export const upsertProfile = spacetimedb.reducer(
  { accountId: t.string(), displayName: t.string(), revision: t.u64() },
  (ctx, { accountId, displayName, revision }) => {
    requireBridge(ctx);
    if (!/^0x[0-9a-f]{40}$/.test(accountId)) {
      throw new SenderError('Account ID must be a lowercase EVM address');
    }
    if (displayName !== displayName.trim() ||
      [...displayName].length < 1 || [...displayName].length > 64 ||
      /[\u0000-\u001f\u007f]/.test(displayName)) {
      throw new SenderError('Invalid display name');
    }
    if (revision < 1n) throw new SenderError('Revision must be positive');

    const existing = ctx.db.playerProfile.accountId.find(accountId);
    if (existing) {
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
      return;
    }
    ctx.db.playerProfile.insert({ accountId, displayName, revision });
  }
);
