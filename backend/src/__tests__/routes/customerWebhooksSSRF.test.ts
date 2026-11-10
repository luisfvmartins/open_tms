import Fastify, { FastifyInstance } from 'fastify';

const mockPrisma: any = {
  apiKey: { count: jest.fn().mockResolvedValue(0) },
  customerWebhook: {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue({ id: 'hook-1', orgId: 'org-1', customerId: 'cust-1' }),
    findUnique: jest.fn().mockResolvedValue({ id: 'hook-1', orgId: 'org-1', customerId: 'cust-1', name: 'Test' }),
    create: jest.fn().mockResolvedValue({ id: 'hook-1', orgId: 'org-1' }),
  },
  customerWebhookDelivery: {
    findMany: jest.fn().mockResolvedValue([
      {
        id: 'del-1',
        webhookId: 'hook-1',
        status: 'failed',
        statusCode: null,
        errorMessage: 'Webhook delivery blocked',
        responseBody: 'Sensitive internal error content that must not leak',
        createdAt: new Date(),
      },
      {
        id: 'del-2',
        webhookId: 'hook-1',
        status: 'delivered',
        statusCode: 200,
        errorMessage: null,
        responseBody: '{"received": true}',
        createdAt: new Date(),
      },
    ]),
  },
  tradingPartner: { count: jest.fn().mockResolvedValue(0) },
  ediTransactionLog: { count: jest.fn().mockResolvedValue(0) },
};

const mockCommandBus: any = {
  dispatch: jest.fn().mockResolvedValue({ success: true, data: { id: 'hook-1' } }),
};

jest.mock('../../middleware/jwtAuth.js', () => ({
  authenticateCustomerJWT: async (req: any) => {
    req.customerUser = { sub: 'cust-user-1', customerId: 'cust-1', email: 'cust@test.com' };
    req.orgId = 'org-1';
  },
}));

jest.mock('../../auth/orgScopeMiddleware.js', () => ({
  attachOrgScopeFromCustomerUserHook: () => async (req: any) => {
    req.orgId = 'org-1';
  },
}));

jest.mock('../../di/index.js', () => ({
  container: {
    resolve: jest.fn(() => mockCommandBus),
  },
  TOKENS: {
    ICommandBus: Symbol('ICommandBus'),
  },
}));

import { customerDeveloperRoutes } from '../../routes/customerDeveloper.js';

describe('Customer Webhooks Route - SSRF Input Validation & Deliveries Sanitization', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    (app as any).prisma = mockPrisma;
    await app.register(customerDeveloperRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/customer-portal/developer/webhooks', () => {
    it('rejects loopback URL (http://127.0.0.1:8080/hook) with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customer-portal/developer/webhooks',
        payload: {
          name: 'Malicious Hook',
          url: 'http://127.0.0.1:8080/hook',
          events: ['order.*'],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.body);
      expect(json.error).toMatch(/protocol.*not allowed|disallowed|blocked/i);
      expect(mockCommandBus.dispatch).not.toHaveBeenCalled();
    });

    it('rejects cloud metadata URL (https://169.254.169.254/latest) with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customer-portal/developer/webhooks',
        payload: {
          name: 'Metadata Exfil',
          url: 'https://169.254.169.254/latest/meta-data',
          events: ['shipment.*'],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.body);
      expect(json.error).toMatch(/cloud metadata|disallowed/i);
      expect(mockCommandBus.dispatch).not.toHaveBeenCalled();
    });

    it('rejects private network RFC 1918 URL (https://10.0.0.1/hook) with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customer-portal/developer/webhooks',
        payload: {
          name: 'Internal VPC scan',
          url: 'https://10.0.0.1/hook',
          events: ['order.*'],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.body);
      expect(json.error).toMatch(/disallowed|private/i);
      expect(mockCommandBus.dispatch).not.toHaveBeenCalled();
    });

    it('rejects embedded credentials URL with HTTP 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customer-portal/developer/webhooks',
        payload: {
          name: 'Credentials In URL',
          url: 'https://admin:secret@example.com/webhook',
          events: ['order.*'],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.body);
      expect(json.error).toMatch(/embedded credentials/i);
    });

    it('accepts legitimate public HTTPS webhook URL with HTTP 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customer-portal/developer/webhooks',
        payload: {
          name: 'Production Orders Webhook',
          url: 'https://example.com/api/webhooks/orders',
          events: ['order.*'],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockCommandBus.dispatch).toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/customer-portal/developer/webhooks/:id/deliveries', () => {
    it('sanitizes and nullifies responseBody on failed deliveries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/customer-portal/developer/webhooks/hook-1/deliveries',
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      const deliveries = json.data;

      // Failed delivery (del-1) MUST have responseBody: null
      const failed = deliveries.find((d: any) => d.id === 'del-1');
      expect(failed.status).toBe('failed');
      expect(failed.responseBody).toBeNull();

      // Delivered delivery (del-2) contains preview
      const delivered = deliveries.find((d: any) => d.id === 'del-2');
      expect(delivered.status).toBe('delivered');
      expect(delivered.responseBody).toBe('{"received": true}');
    });
  });
});
