import { CustomerWebhookDeliveryService, signPayload, verifySignature } from '../../services/webhooks/CustomerWebhookDeliveryService';

describe('webhook signing', () => {
  const secret = 'whsec_test_abc123';
  const body = JSON.stringify({ event: 'rma.authorized', data: { rmaId: 'rma-1' } });

  it('produces a deterministic HMAC-SHA256 signature for a body + timestamp', () => {
    const t = 1713520000;
    const sig1 = signPayload(secret, body, t);
    const sig2 = signPayload(secret, body, t);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies a valid signature within the tolerance window', () => {
    const t = Math.floor(Date.now() / 1000);
    const sig = signPayload(secret, body, t);
    const header = `t=${t},v1=${sig}`;
    expect(verifySignature(secret, header, body)).toBe(true);
  });

  it('rejects a signature beyond the tolerance window', () => {
    const t = Math.floor(Date.now() / 1000) - 600;
    const sig = signPayload(secret, body, t);
    const header = `t=${t},v1=${sig}`;
    expect(verifySignature(secret, header, body, 300)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const t = Math.floor(Date.now() / 1000);
    const sig = signPayload(secret, body, t);
    const header = `t=${t},v1=${sig}`;
    expect(verifySignature(secret, header, body + 'tampered')).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const t = Math.floor(Date.now() / 1000);
    const sig = signPayload('different-secret', body, t);
    const header = `t=${t},v1=${sig}`;
    expect(verifySignature(secret, header, body)).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(verifySignature(secret, 'garbage', body)).toBe(false);
    expect(verifySignature(secret, 't=123', body)).toBe(false);
    expect(verifySignature(secret, 'v1=abc', body)).toBe(false);
  });
});

describe('CustomerWebhookDeliveryService.matches', () => {
  const m = CustomerWebhookDeliveryService.matches;

  it('matches "*" wildcard to any event', () => {
    expect(m(['*'], 'rma.authorized')).toBe(true);
    expect(m(['*'], 'shipment.delivered')).toBe(true);
  });

  it('matches namespace wildcards like rma.*', () => {
    expect(m(['rma.*'], 'rma.authorized')).toBe(true);
    expect(m(['rma.*'], 'rma.completed')).toBe(true);
    expect(m(['rma.*'], 'shipment.delivered')).toBe(false);
  });

  it('matches exact event names', () => {
    expect(m(['rma.authorized'], 'rma.authorized')).toBe(true);
    expect(m(['rma.authorized'], 'rma.rejected')).toBe(false);
  });

  it('returns true if any pattern in the list matches', () => {
    expect(m(['shipment.delivered', 'rma.*'], 'rma.requested')).toBe(true);
    expect(m(['shipment.delivered', 'order.*'], 'rma.requested')).toBe(false);
  });

  it('returns false for empty subscription list', () => {
    expect(m([], 'rma.authorized')).toBe(false);
  });
});

describe('CustomerWebhookDeliveryService.deliver', () => {
  const now = new Date();

  function makePrisma() {
    const delivery = { id: 'del-1', status: 'pending' };
    return {
      customerWebhookDelivery: {
        create: jest.fn().mockResolvedValue(delivery),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...delivery, ...data })),
      },
      customerWebhook: {
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (ops: Promise<any>[]) => Promise.all(ops)),
    } as any;
  }

  const baseWebhook = {
    id: 'hook-1', customerId: 'cust-1', orgId: 'org-1',
    name: 'Test', url: 'https://example.com/hook', secret: 'whsec_xyz',
    enabled: true, events: ['*'], description: null,
    lastDeliveryAt: null, lastStatusCode: null,
    deliveryCount: 0, failureCount: 0,
    createdAt: now, updatedAt: now,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delivers to the endpoint, records statusCode, and marks delivered on 2xx', async () => {
    const mockFetch = jest.spyOn(global, 'fetch' as any).mockResolvedValue(new Response('ok', { status: 200 }) as any);
    const prisma = makePrisma();
    const svc = new CustomerWebhookDeliveryService(prisma);

    const result = await svc.deliver({ webhook: baseWebhook, eventType: 'rma.authorized', payload: { customerId: 'cust-1' } });

    expect(mockFetch).toHaveBeenCalledWith(baseWebhook.url, expect.objectContaining({ method: 'POST' }));
    const callArgs = mockFetch.mock.calls[0][1] as any;
    expect(callArgs.headers['X-OpenTms-Event']).toBe('rma.authorized');
    expect(callArgs.headers['X-OpenTms-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(result.status).toBe('delivered');
    expect(result.statusCode).toBe(200);
    expect(prisma.customerWebhookDelivery.update).toHaveBeenCalled();
  });

  it('records failure when endpoint responds non-2xx', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue(new Response('boom', { status: 500 }) as any);
    const prisma = makePrisma();
    const svc = new CustomerWebhookDeliveryService(prisma);

    const result = await svc.deliver({ webhook: baseWebhook, eventType: 'rma.rejected', payload: {} });

    expect(result.status).toBe('failed');
    expect(result.statusCode).toBe(500);
    expect(result.errorMessage).toMatch(/HTTP 500/);
  });

  it('records failure when endpoint is unreachable', async () => {
    jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('ECONNREFUSED'));
    const prisma = makePrisma();
    const svc = new CustomerWebhookDeliveryService(prisma);

    const result = await svc.deliver({ webhook: baseWebhook, eventType: 'rma.rejected', payload: {} });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toMatch(/ECONNREFUSED/);
  });

  it('blocks SSRF delivery to 127.0.0.1 and sets responseBody to null', async () => {
    const loopbackWebhook = { ...baseWebhook, url: 'https://127.0.0.1:8080/hook' };
    const prisma = makePrisma();
    const svc = new CustomerWebhookDeliveryService(prisma);

    const result = await svc.deliver({ webhook: loopbackWebhook, eventType: 'rma.authorized', payload: {} });

    expect(result.status).toBe('failed');
    expect(result.deliveredAt).toBeNull();
    expect(result.errorMessage).toMatch(/security policy|prohibited/i);
    expect(prisma.customerWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          responseBody: null,
          errorMessage: expect.stringMatching(/security policy/i),
        }),
      })
    );
  });

  it('blocks SSRF delivery to 169.254.169.254 cloud metadata and masks error', async () => {
    const metadataWebhook = { ...baseWebhook, url: 'https://169.254.169.254/latest/meta-data' };
    const prisma = makePrisma();
    const svc = new CustomerWebhookDeliveryService(prisma);

    const result = await svc.deliver({ webhook: metadataWebhook, eventType: 'rma.authorized', payload: {} });

    expect(result.status).toBe('failed');
    expect(result.deliveredAt).toBeNull();
    expect(result.errorMessage).toMatch(/security policy|prohibited/i);
    expect(prisma.customerWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          responseBody: null,
        }),
      })
    );
  });
});
