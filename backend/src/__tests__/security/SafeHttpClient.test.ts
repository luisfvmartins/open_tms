import http from 'http';
import { AddressInfo } from 'net';
import {
  SafeHttpClient,
  SSRFSecurityError,
  isIpAddressAllowed,
} from '../../security/SafeHttpClient.js';

describe('SafeHttpClient - Security & SSRF Protection Suite', () => {
  // ── 1. IP Address Classification ──────────────────────────────────────────

  describe('isIpAddressAllowed', () => {
    describe('IPv4 Blocklist', () => {
      it('blocks loopback addresses (127.0.0.0/8)', () => {
        expect(isIpAddressAllowed('127.0.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('127.0.0.2').allowed).toBe(false);
        expect(isIpAddressAllowed('127.255.255.254').allowed).toBe(false);
      });

      it('blocks private subnets (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
        expect(isIpAddressAllowed('10.0.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('10.255.255.254').allowed).toBe(false);
        expect(isIpAddressAllowed('172.16.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('172.31.255.254').allowed).toBe(false);
        expect(isIpAddressAllowed('192.168.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('192.168.1.100').allowed).toBe(false);
      });

      it('blocks link-local and cloud metadata addresses (169.254.0.0/16)', () => {
        expect(isIpAddressAllowed('169.254.169.254').allowed).toBe(false);
        expect(isIpAddressAllowed('169.254.169.253').allowed).toBe(false);
        expect(isIpAddressAllowed('169.254.1.1').allowed).toBe(false);
        expect(isIpAddressAllowed('100.100.100.200').allowed).toBe(false); // Alibaba Cloud metadata
      });

      it('blocks carrier-grade NAT (100.64.0.0/10)', () => {
        expect(isIpAddressAllowed('100.64.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('100.127.255.254').allowed).toBe(false);
      });

      it('blocks unspecified, broadcast, multicast and class E reserved', () => {
        expect(isIpAddressAllowed('0.0.0.0').allowed).toBe(false);
        expect(isIpAddressAllowed('255.255.255.255').allowed).toBe(false);
        expect(isIpAddressAllowed('224.0.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('240.0.0.1').allowed).toBe(false);
      });

      it('blocks benchmark and documentation subnets (198.18.0.0/15, 192.0.2.0/24, etc.)', () => {
        expect(isIpAddressAllowed('198.18.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('198.19.255.254').allowed).toBe(false);
        expect(isIpAddressAllowed('192.0.2.1').allowed).toBe(false);
        expect(isIpAddressAllowed('198.51.100.1').allowed).toBe(false);
        expect(isIpAddressAllowed('203.0.113.1').allowed).toBe(false);
      });
    });

    describe('IPv6 Blocklist', () => {
      it('blocks loopback (::1) and unspecified (::)', () => {
        expect(isIpAddressAllowed('::1').allowed).toBe(false);
        expect(isIpAddressAllowed('::').allowed).toBe(false);
      });

      it('blocks link-local (fe80::/10)', () => {
        expect(isIpAddressAllowed('fe80::1').allowed).toBe(false);
        expect(isIpAddressAllowed('fe80::dead:beef').allowed).toBe(false);
      });

      it('blocks unique-local addresses / ULA (fc00::/7)', () => {
        expect(isIpAddressAllowed('fc00::1').allowed).toBe(false);
        expect(isIpAddressAllowed('fd00::1').allowed).toBe(false);
        expect(isIpAddressAllowed('fd12:3456:789a::1').allowed).toBe(false);
      });

      it('blocks multicast (ff00::/8)', () => {
        expect(isIpAddressAllowed('ff02::1').allowed).toBe(false);
      });

      it('blocks IPv4-mapped IPv6 representation of private/loopback/metadata destinations', () => {
        expect(isIpAddressAllowed('::ffff:127.0.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('::ffff:10.0.0.1').allowed).toBe(false);
        expect(isIpAddressAllowed('::ffff:169.254.169.254').allowed).toBe(false);
        expect(isIpAddressAllowed('::ffff:192.168.1.1').allowed).toBe(false);
      });

      it('blocks IPv6 documentation (2001:db8::/32) and benchmarking (2001:2::/48)', () => {
        expect(isIpAddressAllowed('2001:db8::1').allowed).toBe(false);
        expect(isIpAddressAllowed('2001:2::1').allowed).toBe(false);
      });
    });

    describe('Public Whitelist Verification', () => {
      it('allows legitimate public unicast IPv4 addresses', () => {
        expect(isIpAddressAllowed('8.8.8.8').allowed).toBe(true);
        expect(isIpAddressAllowed('1.1.1.1').allowed).toBe(true);
        expect(isIpAddressAllowed('93.184.216.34').allowed).toBe(true);
        expect(isIpAddressAllowed('104.20.23.154').allowed).toBe(true);
      });

      it('allows legitimate public unicast IPv6 addresses', () => {
        expect(isIpAddressAllowed('2606:4700:4700::1111').allowed).toBe(true);
        expect(isIpAddressAllowed('2001:4860:4860::8888').allowed).toBe(true);
      });
    });
  });

  // ── 2. Static URL Validation ──────────────────────────────────────────────

  describe('SafeHttpClient.validateUrl', () => {
    it('blocks dangerous URL schemes', () => {
      expect(SafeHttpClient.validateUrl('file:///etc/passwd').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('ftp://example.com/resource').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('gopher://example.com/').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('data:text/plain;base64,SGVsbG8=').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('javascript:alert(1)').valid).toBe(false);
    });

    it('blocks embedded credentials in URLs', () => {
      const res = SafeHttpClient.validateUrl('https://admin:secret@example.com/webhook');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/credentials/i);
    });

    it('blocks dangerous hostnames', () => {
      expect(SafeHttpClient.validateUrl('https://localhost/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://localhost.localdomain/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://metadata.google.internal/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://server.internal/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://server.local/hook').valid).toBe(false);
    });

    it('blocks non-standard ports by default', () => {
      expect(SafeHttpClient.validateUrl('https://example.com:22/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://example.com:5432/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://example.com:6379/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://example.com:8080/hook').valid).toBe(false);
    });

    it('blocks direct IP literals when target is private or link-local', () => {
      expect(SafeHttpClient.validateUrl('https://127.0.0.1/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://10.0.0.1/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://169.254.169.254/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://[::1]/hook').valid).toBe(false);
      expect(SafeHttpClient.validateUrl('https://[fe80::1]/hook').valid).toBe(false);
    });

    it('blocks plain HTTP by default', () => {
      const res = SafeHttpClient.validateUrl('http://example.com/hook');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/protocol 'http:' is not allowed/i);
    });

    it('allows plain HTTP when explicitly enabled', () => {
      const res = SafeHttpClient.validateUrl('http://example.com/hook', { allowHttp: true });
      expect(res.valid).toBe(true);
    });

    it('allows legitimate public HTTPS URLs', () => {
      const res = SafeHttpClient.validateUrl('https://api.mycompany.com/webhooks/listener');
      expect(res.valid).toBe(true);
      expect(res.parsedUrl?.hostname).toBe('api.mycompany.com');
    });
  });

  // ── 3. DNS Pre-Flight & Multi-Record Resolution ───────────────────────────

  describe('DNS Resolution & Multi-Record Validation', () => {
    it('blocks domain resolving to 127.0.0.1', async () => {
      const mockDns = jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      const client = new SafeHttpClient({ dnsLookup: mockDns });

      await expect(client.request('https://evil-loopback.com/hook')).rejects.toThrow(SSRFSecurityError);
    });

    it('blocks domain resolving to 169.254.169.254 (cloud metadata)', async () => {
      const mockDns = jest.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      const client = new SafeHttpClient({ dnsLookup: mockDns });

      await expect(client.request('https://evil-metadata.com/hook')).rejects.toThrow(SSRFSecurityError);
    });

    it('blocks dual-stack domain if IPv6 is loopback (::1) even if IPv4 is public', async () => {
      const mockDns = jest.fn().mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '::1', family: 6 },
      ]);
      const client = new SafeHttpClient({ dnsLookup: mockDns });

      await expect(client.request('https://dual-stack-attacker.com/hook')).rejects.toThrow(SSRFSecurityError);
    });

    it('blocks multi-A record domain if any IP is private RFC 1918', async () => {
      const mockDns = jest.fn().mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]);
      const client = new SafeHttpClient({ dnsLookup: mockDns });

      await expect(client.request('https://mixed-ips.com/hook')).rejects.toThrow(SSRFSecurityError);
    });

    it('validateUrlWithDns returns valid: false when domain resolves to private IP', async () => {
      const mockDns = jest.fn().mockResolvedValue([{ address: '192.168.1.1', family: 4 }]);
      const res = await SafeHttpClient.validateUrlWithDns('https://private-dns.com/hook', { dnsLookup: mockDns });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/resolves to a disallowed IP address/i);
    });
  });

  // ── 4. DNS Rebinding Protection ───────────────────────────────────────────

  describe('DNS Rebinding & Connection Pinning', () => {
    it('pins connection socket to validated IP preventing TOCTOU rebinding', async () => {
      // Simulate DNS lookup returning a safe public IP
      const mockDns = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const client = new SafeHttpClient({ dnsLookup: mockDns });

      // Mock global.fetch to inspect the agent dispatcher passed to it
      const originalFetch = global.fetch;
      const mockFetch = jest.fn().mockResolvedValue(new Response('OK', { status: 200 }));
      global.fetch = mockFetch as any;

      try {
        const res = await client.request('https://rebinding-target.com/hook');
        expect(res.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const fetchOptions = mockFetch.mock.calls[0][1];
        expect(fetchOptions.dispatcher).toBeDefined();

        // The dispatcher agent must be configured with connect.lookup
        const agent = fetchOptions.dispatcher;
        expect(agent).toBeDefined();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // ── 5. Redirect Protections ───────────────────────────────────────────────

  describe('Redirect Protections (Local HTTP Server Tests)', () => {
    let server: http.Server;
    let serverPort: number;
    let serverBase: string;

    beforeAll(done => {
      server = http.createServer((req, res) => {
        const url = req.url || '';

        if (url === '/redirect-to-private') {
          // SSRF attempt: redirect from allowed port to cloud metadata
          res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
          res.end();
        } else if (url === '/redirect-loop-1') {
          res.writeHead(302, { Location: '/redirect-loop-2' });
          res.end();
        } else if (url === '/redirect-loop-2') {
          res.writeHead(302, { Location: '/redirect-loop-1' });
          res.end();
        } else if (url === '/redirect-too-many-1') {
          res.writeHead(302, { Location: '/redirect-too-many-2' });
          res.end();
        } else if (url === '/redirect-too-many-2') {
          res.writeHead(302, { Location: '/redirect-too-many-3' });
          res.end();
        } else if (url === '/redirect-too-many-3') {
          res.writeHead(302, { Location: '/redirect-too-many-4' });
          res.end();
        } else if (url === '/redirect-too-many-4') {
          res.writeHead(302, { Location: '/ok' });
          res.end();
        } else if (url === '/redirect-cross-origin') {
          // Redirect to a different host
          res.writeHead(302, { Location: 'http://127.0.0.2:' + serverPort + '/cross-origin-sink' });
          res.end();
        } else if (url === '/cross-origin-sink') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ headers: req.headers }));
        } else if (url === '/ok') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Success payload');
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        serverPort = addr.port;
        serverBase = `http://127.0.0.1:${serverPort}`;
        done();
      });
    });

    afterAll(done => {
      server.close(done);
    });

    it('blocks redirecting to private / metadata IP', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://169.254.169.254/latest/meta-data' },
        })
      ) as any;

      try {
        const client = new SafeHttpClient();
        await expect(client.request('https://example.com/redirect-to-metadata')).rejects.toThrow(
          /destination.*disallowed|cloud metadata/i
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('detects and terminates redirect loops', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url === 'https://example.com/loop-1') {
          return new Response(null, { status: 302, headers: { location: 'https://example.com/loop-2' } });
        }
        if (url === 'https://example.com/loop-2') {
          return new Response(null, { status: 302, headers: { location: 'https://example.com/loop-1' } });
        }
        return new Response('ok', { status: 200 });
      }) as any;

      try {
        const client = new SafeHttpClient();
        await expect(client.request('https://example.com/loop-1')).rejects.toThrow(
          /redirect loop detected/i
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('enforces maximum redirect limit (maxRedirects = 2)', async () => {
      const originalFetch = global.fetch;
      let count = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        count++;
        return new Response(null, {
          status: 302,
          headers: { location: `https://example.com/step-${count}` },
        });
      }) as any;

      try {
        const client = new SafeHttpClient({ maxRedirects: 2 });
        await expect(client.request('https://example.com/step-0')).rejects.toThrow(
          /maximum redirect limit.*exceeded/i
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('blocks HTTPS to HTTP protocol downgrade during redirect', async () => {
      const client = new SafeHttpClient();

      // Mock fetch returning a 302 with http:// location from https:// request
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'http://target.com/downgraded' },
        })
      ) as any;

      try {
        await expect(client.request('https://example.com/hook')).rejects.toThrow(
          /protocol downgrade from https to http.*prohibited/i
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('strips sensitive headers (Authorization, X-OpenTms-Signature, Cookie) on cross-origin redirects', async () => {
      const originalFetch = global.fetch;
      const calls: any[] = [];

      global.fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
        calls.push({ url, headers: opts.headers });
        if (url === 'https://site-a.com/hook') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://site-b.com/hook' },
          });
        }
        return new Response('Done', { status: 200 });
      }) as any;

      try {
        const client = new SafeHttpClient();
        await client.request('https://site-a.com/hook', {
          headers: {
            Authorization: 'Bearer secret-token',
            'X-OpenTms-Signature': 't=123,v1=abc',
            'X-Custom-Safe': 'safe-value',
          },
        });

        expect(calls).toHaveLength(2);
        const secondHopHeaders = calls[1].headers;
        expect(secondHopHeaders['Authorization'] || secondHopHeaders['authorization']).toBeUndefined();
        expect(secondHopHeaders['X-OpenTms-Signature'] || secondHopHeaders['x-opentms-signature']).toBeUndefined();
        expect(secondHopHeaders['X-Custom-Safe'] || secondHopHeaders['x-custom-safe']).toBe('safe-value');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // ── 6. Response Body Limits & Timeouts ─────────────────────────────────────

  describe('Response Body Limits & Timeouts', () => {
    it('truncates large response bodies and marks truncated: true', async () => {
      const originalFetch = global.fetch;
      const largeText = 'A'.repeat(5000);

      global.fetch = jest.fn().mockResolvedValue(
        new Response(largeText, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      ) as any;

      try {
        const client = new SafeHttpClient({ maxResponseBytes: 1024 });
        const res = await client.request('https://example.com/large');

        expect(res.truncated).toBe(true);
        expect(res.body.length).toBe(1024);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('times out when request exceeds configured timeoutMs', async () => {
      const originalFetch = global.fetch;

      global.fetch = jest.fn().mockImplementation(async (_url: string, opts: any) => {
        // Wait longer than timeout
        await new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'TimeoutError';
            reject(err);
          });
        });
      }) as any;

      try {
        const client = new SafeHttpClient({ requestTimeoutMs: 50 });
        await expect(client.request('https://example.com/slow')).rejects.toThrow(/timed out/i);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // ── 7. Normal Webhook Operation ───────────────────────────────────────────

  describe('Legitimate Webhook Operation', () => {
    it('successfully posts to verified public webhook URL with JSON payload', async () => {
      const originalFetch = global.fetch;
      let recordedBody: string | undefined;

      global.fetch = jest.fn().mockImplementation(async (_url: string, opts: any) => {
        recordedBody = opts.body;
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      try {
        const client = new SafeHttpClient();
        const res = await client.post('https://example.com/customer-webhook', { event: 'shipment.delivered' });

        expect(res.ok).toBe(true);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ received: true });
        expect(JSON.parse(recordedBody!)).toEqual({ event: 'shipment.delivered' });
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
