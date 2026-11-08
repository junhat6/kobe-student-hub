import { describe, expect, it, vi } from 'vitest';
import { publicContactUrl, isPublicServiceInfo } from '../src/shared/service-info';
import { publicServiceInfo } from '../worker/service-info';
import { createServiceInfoClient } from '../src/account/service-info-client';

describe('a deliberately public contact destination', () => {
  it('accepts HTTPS and one plain mail recipient without adding private message fields', () => {
    expect(publicContactUrl('https://SUPPORT.example.org/help?topic=hub#contact')).toBe(
      'https://support.example.org/help?topic=hub#contact',
    );
    expect(publicContactUrl('mailto:student-help+hub@example.org')).toBe(
      'mailto:student-help+hub@example.org',
    );
  });
  it('rejects credentials, protocol confusion, header injection, multiple recipients and excessive values', () => {
    for (const value of [
      null,
      {},
      '',
      ' https://support.example.org',
      'javascript:alert(1)',
      '//support.example.org',
      'http://support.example.org',
      'data:text/html,hello',
      'https://user:password@support.example.org/help',
      'https://secret%40name@support.example.org',
      'https://support.example.org:444/help',
      'https://support.example.org?access_token=secret',
      'https://support.example.org?auth_token=secret',
      'https://support.example.org?jwt=secret',
      'https://support.example.org?API-Key=secret',
      'https://support.example.org#id_token=secret',
      'https://support.example.org?%74oken=secret',
      'https://support.example.org/%0d%0aInjected',
      'mailto:one@example.org,two@example.org',
      'mailto:one@example.org;two@example.org',
      'mailto:one@example.org?bcc=two@example.org',
      'mailto:one@example.org#subject',
      'mailto:one%0A@example.org',
      'mailto:one%250A@example.org',
      'mailto:one@example.org\n',
      'mailto:' + 'a'.repeat(65) + '@example.org',
      'https://support.example.org/' + 'a'.repeat(2048),
    ])
      expect(publicContactUrl(value), String(value)).toBeNull();
  });
  it('projects only the public setting and never falls back to operator or Google values', () => {
    const fields = {
      MODERATION_EMAIL_TO: 'PRIVATE_OPERATOR@example.invalid',
      GOOGLE_CLIENT_SECRET: 'PRIVATE_SECRET',
      AUTH_ORIGIN: 'https://app.example.invalid',
    };
    expect(publicServiceInfo({ ...fields, PUBLIC_CONTACT_URL: undefined })).toEqual({
      contactUrl: null,
    });
    expect(
      publicServiceInfo({ ...fields, PUBLIC_CONTACT_URL: 'https://secret@support.example.org' }),
    ).toEqual({ contactUrl: null });
    const env = new Proxy(
      { PUBLIC_CONTACT_URL: 'https://support.example.org/' },
      {
        get(target, key) {
          if (key !== 'PUBLIC_CONTACT_URL') throw Error('Private binding was read');
          return target.PUBLIC_CONTACT_URL;
        },
      },
    );
    expect(publicServiceInfo(env)).toEqual({ contactUrl: 'https://support.example.org/' });
  });
  it('accepts only the exact bounded DTO and rejects extra private fields or noncanonical URLs', () => {
    expect(isPublicServiceInfo({ contactUrl: null })).toBe(true);
    expect(isPublicServiceInfo({ contactUrl: 'mailto:help@example.org' })).toBe(true);
    for (const value of [
      null,
      [],
      {},
      { contactUrl: undefined },
      { contactUrl: 1 },
      { contactUrl: 'https://SUPPORT.example.org' },
      { contactUrl: 'javascript:alert(1)' },
      { contactUrl: null, email: 'private@example.invalid' },
      { contactUrl: null, operatorId: 'private-id' },
    ])
      expect(isPublicServiceInfo(value)).toBe(false);
  });
});

describe('anonymous public service information transport', () => {
  it('omits credentials and sends no profile, registration input or message body', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ contactUrl: 'https://support.example.org/' }),
    );
    expect(await createServiceInfoClient(fetcher).read()).toEqual({
      contactUrl: 'https://support.example.org/',
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/service-info',
      expect.objectContaining({
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json' },
      }),
    );
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
  });
  it('rejects private extra fields, unsafe destinations, oversized responses and non-JSON responses', async () => {
    for (const response of [
      Response.json({ contactUrl: null, privateEmail: 'PRIVATE@example.invalid' }),
      Response.json({ contactUrl: 'mailto:a@example.org?body=PRIVATE' }),
      Response.json({ contactUrl: 'https://support.example.org/' + 'a'.repeat(5000) }),
      new Response('not json', { headers: { 'Content-Type': 'text/html' } }),
      Response.json({ contactUrl: null }, { status: 503 }),
    ])
      await expect(createServiceInfoClient(async () => response).read()).rejects.toThrow();
  });
  it('waits through EOF instead of accepting a valid prefix before private trailing fields arrive', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        value.enqueue(new TextEncoder().encode('{"contactUrl":null}'));
      },
    });
    let settled = false;
    const read = createServiceInfoClient(
      async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }),
    )
      .read()
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    controller.enqueue(new TextEncoder().encode('{"private":"UNEXPECTED"}'));
    controller.close();
    await expect(read).rejects.toThrow();
  });
});
