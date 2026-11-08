import { describe, it, expect } from 'vitest';
import {
  AUTHORIZATION_HEADER,
  proofAuthorization,
  parseProofAuthorization,
  hasLegacyProofHeader,
} from '../src/shared/auth-proof';
const token = 't'.repeat(43);
describe('purpose-bound standard Authorization transport', () => {
  for (const purpose of ['command', 'csrf'] as const)
    it('round-trips only ' + purpose, () => {
      const value = proofAuthorization(purpose, token);
      expect(value).toBe('Bearer ' + purpose + '.' + token);
      expect(parseProofAuthorization(new Headers({ [AUTHORIZATION_HEADER]: value }))).toEqual({
        purpose,
        token,
      });
    });
  for (const value of [
    '',
    token,
    'Bearer ' + token,
    'Bearer csrf.' + token.slice(1),
    'Bearer csrf.' + token + 'x',
    'Bearer command.' + token + ', Bearer csrf.' + token,
    'Bearer other.' + token,
    'Bearer CSRF.' + token,
    'bearer csrf.' + token,
    'Bearer  csrf.' + token,
    'Bearer\tcsrf.' + token,
    'Basic csrf.' + token,
    'Bearer csrf.' + token + '.',
    'Bearer csrf.' + token.slice(1) + '=',
  ])
    it('rejects malformed ' + JSON.stringify(value.slice(0, 28)), () =>
      expect(parseProofAuthorization(new Headers({ Authorization: value }))).toBeNull(),
    );
  it('rejects duplicate fields, including different field-name casing', () => {
    for (const second of [proofAuthorization('csrf', token), proofAuthorization('command', token)])
      expect(
        parseProofAuthorization(
          new Headers([
            ['Authorization', proofAuthorization('csrf', token)],
            ['authorization', second],
          ]),
        ),
      ).toBeNull();
  });
  for (const legacy of ['X-CSRF-Token', 'X-Session-Command'])
    it('has no standalone or mixed fallback for ' + legacy, () => {
      for (const value of ['', token]) {
        const h = new Headers({ [legacy]: value });
        expect(hasLegacyProofHeader(h)).toBe(true);
        expect(parseProofAuthorization(h)).toBeNull();
        h.set('Authorization', proofAuthorization('csrf', token));
        expect(parseProofAuthorization(h)).toBeNull();
      }
    });
  it('generator refuses malformed purpose/token without reflecting its value', () => {
    for (const value of ['private-secret', 'x'.repeat(42), 'x'.repeat(44), 'x'.repeat(42) + ' '])
      expect(() => proofAuthorization('csrf', value)).toThrow('Invalid browser proof');
    expect(() => proofAuthorization('other' as any, token)).toThrow('Invalid browser proof');
  });
});
