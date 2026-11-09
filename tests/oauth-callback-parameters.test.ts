import { expect, it } from 'vitest';
import {
  callbackParameters,
  callbackReceiverHtml,
  callbackReceiverScript,
  callbackReceiverCsp,
} from '../worker/auth/callback-receiver';
const state = 's'.repeat(43);
it('accepts code or provider denial and drops bounded metadata before the internal claim', () => {
  expect(
    callbackParameters(
      new URLSearchParams({
        state,
        code: 'code/one',
        iss: 'https://accounts.google.com',
        scope: 'openid email',
        authuser: '0',
      }).toString(),
    )?.toString(),
  ).toBe(
    new URLSearchParams({ state, code: 'code/one', iss: 'https://accounts.google.com' }).toString(),
  );
  expect(
    callbackParameters(
      new URLSearchParams({
        state,
        error: 'access_denied',
        error_description: 'No consent',
      }).toString(),
    )?.toString(),
  ).toBe(new URLSearchParams({ state, error: 'access_denied' }).toString());
});
it('rejects duplicate critical fields, malformed values and ambiguous encoding', () => {
  for (const raw of [
    `state=${state}&code=a&code=b`,
    `state=${state}&%63ode=a&code=b`,
    `state=${state}&code=a&iss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com`,
    `state=${state}&code=a&error=access_denied`,
    `state=${state}`,
    `state=${state}&code=`,
    `state=short&code=a`,
    `state=${state}&code=%ZZ`,
    `state=${state}&code=a&error_description=%C0%AF`,
    `state=${state}&code=a&scope=%0a`,
    new URLSearchParams({ state, code: 'a', iss: 'https://evil.test' }).toString(),
    new URLSearchParams({ state, code: 'a'.repeat(2049) }).toString(),
  ])
    expect(callbackParameters(raw), raw).toBeNull();
});
it('uses a same-origin external script and cleans the URL before any POST without provider DOM/log/storage sinks', () => {
  expect(callbackReceiverHtml).toContain('src="/api/auth/callback/receive.js"');
  expect(callbackReceiverCsp).toContain("default-src 'none'");
  expect(callbackReceiverCsp).toContain("script-src 'self'");
  expect(callbackReceiverScript.indexOf('history.replaceState')).toBeLessThan(
    callbackReceiverScript.indexOf("fetch('/api/auth/callback'"),
  );
  expect(callbackReceiverScript).toContain("redirect: 'manual'");
  expect(callbackReceiverScript).toContain('if (!critical.has(key)) continue');
  expect(callbackReceiverScript).toContain('if (critical.has(key)) body.append(key,value)');
  expect(callbackReceiverScript).not.toMatch(
    /console\.|localStorage|sessionStorage|innerHTML|document\.write/,
  );
});

it('ignores bounded provider extensions and duplicate noncritical metadata', () => {
  expect(
    callbackParameters(`state=${state}&code=a&extra1=extension&scope=x&scope=y`)?.toString(),
  ).toBe(`state=${state}&code=a`);
  expect(callbackParameters(`state=${state}&code=a&extra1=${'x'.repeat(1025)}`)).toBeNull();
  expect(
    callbackParameters(
      `state=${state}&code=a&` + Array.from({ length: 63 }, (_, i) => `extra${i}=x`).join('&'),
    ),
  ).toBeNull();
});
