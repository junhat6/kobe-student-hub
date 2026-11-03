/** Future callers must load this actor from a verified server-side session, never request JSON. */
export interface ServerSessionActor {
  accountId: string;
  accountStatus: 'active' | 'suspended' | 'deleted';
}

/** A narrow ownership policy, not a session authenticator or an administrator override. */
export function mayReadPrivateRecord(
  actor: ServerSessionActor | null | undefined,
  ownerAccountId: string,
): boolean {
  return actor?.accountStatus === 'active'
    && actor.accountId.length > 0
    && ownerAccountId.length > 0
    && actor.accountId === ownerAccountId;
}
