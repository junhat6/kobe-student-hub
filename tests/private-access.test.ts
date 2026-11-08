import { describe, it, expect } from 'vitest';
import { mayReadPrivateRecord } from '../worker/auth/private-access';
describe('private record ownership policy (trusted server actor input only)', () => {
  it('allows only the active owner', () => {
    expect(mayReadPrivateRecord({ accountId: 'owner', accountStatus: 'active' }, 'owner')).toBe(
      true,
    );
  });
  it('denies missing session, other users, empty owners and inactive accounts', () => {
    expect(mayReadPrivateRecord(null, 'owner')).toBe(false);
    expect(mayReadPrivateRecord(undefined, 'owner')).toBe(false);
    expect(mayReadPrivateRecord({ accountId: 'other', accountStatus: 'active' }, 'owner')).toBe(
      false,
    );
    expect(mayReadPrivateRecord({ accountId: '', accountStatus: 'active' }, '')).toBe(false);
    for (const accountStatus of ['suspended', 'deleted'] as const)
      expect(mayReadPrivateRecord({ accountId: 'owner', accountStatus }, 'owner')).toBe(false);
  });
});
