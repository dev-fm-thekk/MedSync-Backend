/**
 * MedVault REST API Tests
 * Framework: Vitest + Supertest
 *
 * Run:  npx vitest run
 *   or: npx vitest (watch mode)
 *
 * Accounts:
 *   OWNER   — 0x15d34aaf54267db7d7c367839aaf71a00a2c6a65  (record owner / signer)
 *   DOCTOR1 — 0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc  (granted access)
 *   DOCTOR2 — 0x90f79bf6eb2c4f870365e785982e1f101e93b906  (granted access)
 *   UNAUTH  — 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc  (never granted)
 *
 * WHY TWO FIXES WERE NEEDED:
 *
 * 1. TEMPORAL DEAD ZONE — vi.mock() is hoisted to the top of the file by
 *    Vitest's transform, which means it runs BEFORE any const/let declarations.
 *    Referencing `GRANTED` inside vi.mock() caused a ReferenceError because
 *    the variable didn't exist yet. Fix: use inline literals inside vi.mock(),
 *    never reference outer variables.
 *
 * 2. SCHEMA MOCK — route.ts imports mintSchema and grantAccessSchema from
 *    schema.js. Without mocking schema.js, Vitest tries to load the real
 *    module and safeParse() returns unexpected results (or throws). Fix: mock
 *    schema.js to always return { success: true, data: req.body } so route
 *    logic flows normally and only the contract layer is stubbed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── 1. Mock schema.js ─────────────────────────────────────────────────────────
// Must be above all other mocks. Always returns success so validation passes,
// letting us test the route/contract layer in isolation.

vi.mock('../utils/schema.js', () => ({
  mintSchema: {
    safeParse: (body: unknown) => {
      const b = body as Record<string, unknown>;
      const missing = ['patientAddress', 'encryptedPayload', 'account'].filter(k => !b[k]);
      const invalidAddr = ['patientAddress', 'account'].filter(
        k => b[k] && typeof b[k] === 'string' && !(b[k] as string).startsWith('0x')
      );
      if (missing.length || invalidAddr.length) {
        return {
          success: false,
          error: { errors: [...missing.map(k => ({ path: [k], message: 'Required' })), ...invalidAddr.map(k => ({ path: [k], message: 'Invalid address' }))] },
        };
      }
      return { success: true, data: body };
    },
  },
  grantAccessSchema: {
    safeParse: (body: unknown) => {
      const b = body as Record<string, unknown>;
      const missing = ['tokenId', 'doctorAddress', 'account', 'durationSeconds'].filter(k => b[k] === undefined || b[k] === null || b[k] === '');
      if (missing.length) {
        return {
          success: false,
          error: { errors: missing.map(k => ({ path: [k], message: 'Required' })) },
        };
      }
      return { success: true, data: body };
    },
  },
}));

// ── 2. Mock action.js ─────────────────────────────────────────────────────────
// IMPORTANT: Do NOT reference any outer const/let here — vi.mock is hoisted
// before variable declarations, causing a ReferenceError (temporal dead zone).
// Use only inline literals inside the factory function.

vi.mock('../action.js', () => ({
  mintRecord: vi.fn(async () => ({
    message: 'successfully uploaded file, minted nft',
    hash:    '0xmocktxhash_mint',
    receipt: { transactionHash: '0xmocktxhash_mint', status: 'success', blockNumber: 1 },
  })),

  accessGrant: vi.fn(async () => ({
    message: 'successfully granted access',
    hash:    '0xmocktxhash_grant',
    receipt: { transactionHash: '0xmocktxhash_grant', status: 'success', blockNumber: 2 },
  })),

  // Inline the granted list — cannot reference GRANTED const here (hoisting)
  getRecordAccess: vi.fn(async (_tokenId: number, doctorAddress: string) => ({
    success:   true,
    hasAccess: [
      '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc', // doctor1
      '0x90f79bf6eb2c4f870365e785982e1f101e93b906',  // doctor2
    ].includes(doctorAddress.toLowerCase()),
  })),

  isContractLive: vi.fn(async () => ({
    message: 'contract is live',
    address: '0xMockContractAddress',
  })),
}));

// ── Static imports — resolved AFTER mocks are hoisted ────────────────────────
import { mintRecord, accessGrant, getRecordAccess, isContractLive } from '../action.js';

// ── Accounts (safe to declare here — only used in test bodies, not in mock) ───
const ACCOUNTS = {
  owner:   '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
  doctor1: '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  doctor2: '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  unauth:  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
};

const AUTH         = 'test-auth-token';
const MOCK_SC_ADDR = '0xMockContractAddress';

// ── App setup ─────────────────────────────────────────────────────────────────
let app: express.Express;

beforeAll(async () => {
  process.env.MEDIVAULT_SC_ADDRESS = MOCK_SC_ADDR;

  // Dynamic import so route.ts loads AFTER both mocks are in place
  const { default: router } = await import('../routes/access-route.js');
  app = express();
  app.use(express.json());
  app.use("/api", router);
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/records/mint
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/records/mint', () => {

  const USER_ID  = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const MINT_URL = `/api/v1/records/${USER_ID}/mint`;

  const validBody = {
    patientAddress:   '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    encryptedPayload: 'U2FsdGVkX1+encryptedData==',
    metadata:         { recordType: 'blood-test', date: '2026-02-22' },
    account:          '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
  };

  it('200 — mints a record with valid payload and auth', async () => {
    const res = await request(app)
      .post(MINT_URL)
      .set('x-patient-signature', AUTH)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('0xmocktxhash_mint');
    expect(res.body.receipt).toBeDefined();
    expect(res.body.message).toBeDefined();
  });

  it('200 — calls mintRecord with correct arguments', async () => {
    vi.mocked(mintRecord).mockClear();

    await request(app)
      .post(MINT_URL)
      .set('x-patient-signature', AUTH)
      .send(validBody);

    expect(mintRecord).toHaveBeenCalledOnce();
    expect(mintRecord).toHaveBeenCalledWith(
      validBody.patientAddress,
      validBody.encryptedPayload,
      validBody.metadata,
      validBody.account,
      USER_ID,
    );
  });

  it('401 — rejects request with no auth header', async () => {
    const res = await request(app)
      .post(MINT_URL)
      .send(validBody);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it('400 — rejects missing patientAddress', async () => {
    const { patientAddress: _, ...body } = validBody;
    const res = await request(app)
      .post(MINT_URL)
      .set('x-patient-signature', AUTH)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('400 — rejects missing encryptedPayload', async () => {
    const { encryptedPayload: _, ...body } = validBody;
    const res = await request(app)
      .post(MINT_URL)
      .set('x-patient-signature', AUTH)
      .send(body);

    expect(res.status).toBe(400);
  });

  it('400 — rejects missing account', async () => {
    const { account: _, ...body } = validBody;
    const res = await request(app)
      .post(MINT_URL)
      .set('x-patient-signature', AUTH)
      .send(body);

    expect(res.status).toBe(400);
  });

  it('500 — forwards contract revert error', async () => {
    vi.mocked(mintRecord).mockResolvedValueOnce({ error: 'reverted: insufficient gas' } as any);

    const res = await request(app)
      .post(MINT_URL)
      .set('x-patient-signature', AUTH)
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/insufficient gas/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/records/access/grant
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/records/access/grant', () => {

  const GRANT_USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const GRANT_URL     = `/api/v1/records/access/${GRANT_USER_ID}/grant`;

  const grantToDoctor1 = {
    tokenId:         '1',
    doctorAddress:   '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
    account:         '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    durationSeconds: 86400,
  };

  const grantToDoctor2 = {
    tokenId:         '1',
    doctorAddress:   '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    account:         '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    durationSeconds: 3600,
  };

  it('200 — owner grants access to doctor1', async () => {
    const before = Math.floor(Date.now() / 1000);

    const res = await request(app)
      .post(GRANT_URL)
      .set('x-patient-signature', AUTH)
      .send(grantToDoctor1);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.txHash).toBe('0xmocktxhash_grant');
    expect(res.body.receipt).toBeDefined();
    expect(res.body.expiry).toBeGreaterThanOrEqual(before + 86400);
  });

  it('200 — owner grants access to doctor2', async () => {
    const res = await request(app)
      .post(GRANT_URL)
      .set('x-patient-signature', AUTH)
      .send(grantToDoctor2);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('200 — calls accessGrant with correct args', async () => {
    vi.mocked(accessGrant).mockClear();

    await request(app)
      .post(GRANT_URL)
      .set('x-patient-signature', AUTH)
      .send(grantToDoctor1);

    expect(accessGrant).toHaveBeenCalledOnce();
    expect(accessGrant).toHaveBeenCalledWith(
      grantToDoctor1.tokenId,
      grantToDoctor1.doctorAddress,
      grantToDoctor1.account,
      86400,
      GRANT_USER_ID,
    );
  });

  it('200 — expiry is correctly computed from durationSeconds', async () => {
    const before = Math.floor(Date.now() / 1000);

    const res = await request(app)
      .post(GRANT_URL)
      .set('x-patient-signature', AUTH)
      .send({ ...grantToDoctor1, durationSeconds: 7200 });

    expect(res.body.expiry).toBeGreaterThanOrEqual(before + 7200);
    expect(res.body.expiry).toBeLessThan(before + 7210); // 10s tolerance
  });

  it('401 — rejects missing auth header', async () => {
    const res = await request(app)
      .post(GRANT_URL)
      .send(grantToDoctor1);

    expect(res.status).toBe(401);
  });

  it('400 — rejects missing tokenId', async () => {
    const { tokenId: _, ...body } = grantToDoctor1;
    const res = await request(app)
      .post(GRANT_URL)
      .set('x-patient-signature', AUTH)
      .send(body);

    expect(res.status).toBe(400);
  });

  it('400 — rejects missing doctorAddress', async () => {
    const { doctorAddress: _, ...body } = grantToDoctor1;
    const res = await request(app)
      .post(GRANT_URL)
      .set('x-patient-signature', AUTH)
      .send(body);

    expect(res.status).toBe(400);
  });

  it('400 — rejects missing durationSeconds', async () => {
    const { durationSeconds: _, ...body } = grantToDoctor1;
    const res = await request(app)
      .post(GRANT_URL)
      .set('x-patient-signature', AUTH)
      .send(body);

    expect(res.status).toBe(400);
  });

  it('500 — forwards contract revert error', async () => {
    vi.mocked(accessGrant).mockResolvedValueOnce({ error: 'reverted: not owner' } as any);

    const res = await request(app)
      .post(GRANT_URL)
      .set('x-patient-signature', AUTH)
      .send(grantToDoctor1);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not owner/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/records/:tokenId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/records/:tokenId', () => {

  it('200 — doctor1 fetches a record they have access to', async () => {
    const res = await request(app)
      .get(`/api/v1/records/1?doctorAddress=${ACCOUNTS.doctor1}`)
      .set('x-patient-signature', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.accessActive).toBe(true);
    expect(res.body.tokenId).toBe(1);
    expect(res.body.doctorAddress).toBe(ACCOUNTS.doctor1);
    expect(res.body.cid).toBeDefined();
    expect(res.body.fileHash).toBeDefined();
  });

  it('200 — doctor2 fetches a record they have access to', async () => {
    const res = await request(app)
      .get(`/api/v1/records/1?doctorAddress=${ACCOUNTS.doctor2}`)
      .set('x-patient-signature', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.accessActive).toBe(true);
  });

  it('200 — calls getRecordAccess with parsed tokenId and doctorAddress', async () => {
    vi.mocked(getRecordAccess).mockClear();

    await request(app)
      .get(`/api/v1/records/42?doctorAddress=${ACCOUNTS.doctor1}`)
      .set('x-patient-signature', AUTH);

    expect(getRecordAccess).toHaveBeenCalledOnce();
    expect(getRecordAccess).toHaveBeenCalledWith(42, ACCOUNTS.doctor1);
  });

  it('403 — unauth account is denied', async () => {
    const res = await request(app)
      .get(`/api/v1/records/1?doctorAddress=${ACCOUNTS.unauth}`)
      .set('x-patient-signature', AUTH);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });

  it('401 — rejects missing auth header', async () => {
    const res = await request(app)
      .get(`/api/v1/records/1?doctorAddress=${ACCOUNTS.doctor1}`);

    expect(res.status).toBe(401);
  });

  it('404 — rejects non-numeric tokenId', async () => {
    const res = await request(app)
      .get(`/api/v1/records/abc?doctorAddress=${ACCOUNTS.doctor1}`)
      .set('x-patient-signature', AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/token id not found/i);
  });

  it('403 — rejects missing doctorAddress query param', async () => {
    const res = await request(app)
      .get('/api/v1/records/1')
      .set('x-patient-signature', AUTH);

    expect(res.status).toBe(403);
  });

  it('403 — rejects doctorAddress not starting with 0x', async () => {
    const res = await request(app)
      .get('/api/v1/records/1?doctorAddress=notanaddress')
      .set('x-patient-signature', AUTH);

    expect(res.status).toBe(403);
  });

  it('500 — forwards on-chain RPC failure', async () => {
    vi.mocked(getRecordAccess).mockResolvedValueOnce({
      success:   false,
      hasAccess: false,
      error:     'RPC connection refused',
    });

    const res = await request(app)
      .get(`/api/v1/records/1?doctorAddress=${ACCOUNTS.doctor1}`)
      .set('x-patient-signature', AUTH);

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/system/status
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/system/status', () => {

  it('200 — returns chain, contract, ipfs and contractStatus fields', async () => {
    const res = await request(app).get('/api/v1/system/status');

    expect(res.status).toBe(200);
    expect(res.body.chain).toBe('connected');
    expect(res.body.contract).toBe(MOCK_SC_ADDR);
    expect(res.body.contractStatus).toBe('contract is live');
    expect(res.body.ipfs).toBeDefined();
  });

  it('200 — calls isContractLive with the SC address from env', async () => {
    vi.mocked(isContractLive).mockClear();

    await request(app).get('/api/v1/system/status');

    expect(isContractLive).toHaveBeenCalledOnce();
    expect(isContractLive).toHaveBeenCalledWith(MOCK_SC_ADDR);
  });

  it('200 — publicly accessible without auth header', async () => {
    // Deliberately no .set('x-patient-signature', ...) 
    const res = await request(app).get('/api/v1/system/status');

    expect(res.status).toBe(200);
  });

  it('500 — returns error when contract is not live', async () => {
    vi.mocked(isContractLive).mockResolvedValueOnce({ error: 'no bytecode at address' } as any);

    const res = await request(app).get('/api/v1/system/status');

    expect(res.status).toBe(500);
    expect(res.body.chain).toBe('error');
  });

});