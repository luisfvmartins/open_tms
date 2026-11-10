import { CallWebhookSkill } from '../../services/skills/CallWebhookSkill.js';
import { SafeHttpClient } from '../../security/SafeHttpClient.js';

describe('CallWebhookSkill - SSRF & Execution Hardening', () => {
  let skill: CallWebhookSkill;

  beforeEach(() => {
    skill = new CallWebhookSkill();
  });

  describe('validateConfig', () => {
    it('returns error when url is missing', () => {
      const res = skill.validateConfig({});
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('Webhook URL is required');
    });

    it('rejects loopback and private IP URLs', () => {
      const res1 = skill.validateConfig({ url: 'http://127.0.0.1:8080/hook' });
      expect(res1.valid).toBe(false);

      const res2 = skill.validateConfig({ url: 'https://10.0.0.1/hook' });
      expect(res2.valid).toBe(false);

      const res3 = skill.validateConfig({ url: 'https://169.254.169.254/hook' });
      expect(res3.valid).toBe(false);
    });

    it('rejects non-HTTP(S) schemes and embedded credentials', () => {
      const res1 = skill.validateConfig({ url: 'file:///etc/passwd' });
      expect(res1.valid).toBe(false);

      const res2 = skill.validateConfig({ url: 'https://user:pass@example.com/webhook' });
      expect(res2.valid).toBe(false);
    });

    it('accepts valid public HTTPS URL', () => {
      const res = skill.validateConfig({ url: 'https://api.example.com/webhooks' });
      expect(res.valid).toBe(true);
      expect(res.errors).toBeUndefined();
    });
  });

  const makeParams = (config: Record<string, unknown>, fields: Record<string, unknown> = {}) => ({
    config,
    fields,
    event: { id: 'evt-1', type: 'test', timestamp: new Date().toISOString() } as any,
    context: {},
    orgId: 'org-1',
  });

  describe('execute', () => {
    it('blocks request to private or metadata IP and returns clean error', async () => {
      const result = await skill.execute(
        makeParams({ url: 'https://127.0.0.1/hook' }, { body: '{"test": 1}' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/security policy|prohibited/i);
    });

    it('blocks request to domain resolving to loopback', async () => {
      const mockDns = jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      const safeClient = new SafeHttpClient({ dnsLookup: mockDns });
      const skillWithCustomClient = new CallWebhookSkill(safeClient);

      const result = await skillWithCustomClient.execute(
        makeParams({ url: 'https://attacker-domain.com/hook' }, {})
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/security policy|prohibited/i);
    });

    it('executes legitimate public webhook successfully', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        })
      ) as any;

      try {
        const result = await skill.execute(
          makeParams(
            {
              url: 'https://example.com/api/webhook',
              authType: 'bearer',
              authValue: 'token-123',
            },
            { body: '{"event": "ping"}' }
          )
        );

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ statusCode: 200, statusText: 'OK' });
        expect(result.error).toBeUndefined();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
