/**
 * Event publish policy unit tests
 */
import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mockCountDocuments = jest.fn();

let resolvePublishPolicy;
let buildAutoFeaturePayload;
let TRUST_AUTO_PUBLISH_MIN;
let TRUST_AUTO_FEATURE_MIN;

beforeAll(async () => {
  const mongoModelPath = resolve(__dirname, '../../../../model/mongoModel.js');
  jest.unstable_mockModule(mongoModelPath, () => ({
    Event: {
      countDocuments: mockCountDocuments,
    },
  }));

  const mod = await import(
    resolve(__dirname, '../../../../src/services/eventPublishPolicy.js')
  );
  resolvePublishPolicy = mod.resolvePublishPolicy;
  buildAutoFeaturePayload = mod.buildAutoFeaturePayload;
  TRUST_AUTO_PUBLISH_MIN = mod.TRUST_AUTO_PUBLISH_MIN;
  TRUST_AUTO_FEATURE_MIN = mod.TRUST_AUTO_FEATURE_MIN;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('eventPublishPolicy', () => {
  it('exposes expected thresholds', () => {
    expect(TRUST_AUTO_PUBLISH_MIN).toBe(1);
    expect(TRUST_AUTO_FEATURE_MIN).toBe(5);
  });

  it('keeps first event inactive when completedCount is 0', async () => {
    mockCountDocuments.mockResolvedValue(0);
    const result = await resolvePublishPolicy(
      { status: 'active' },
      'merchant-1',
      { eventEndDate: new Date('2030-01-01') }
    );
    expect(result).toMatchObject({
      active: false,
      featured: null,
      completedCount: 0,
      tier: 0,
    });
  });

  it('auto-publishes when merchant has at least 1 completed event', async () => {
    mockCountDocuments.mockResolvedValue(1);
    const result = await resolvePublishPolicy(
      { status: 'active' },
      'merchant-1',
      { eventEndDate: new Date('2030-01-01') }
    );
    expect(result.active).toBe(true);
    expect(result.featured).toBeNull();
    expect(result.tier).toBe(1);
  });

  it('auto-publishes and auto-features when merchant has 5+ completed events', async () => {
    mockCountDocuments.mockResolvedValue(5);
    const end = new Date('2030-06-01T12:00:00.000Z');
    const result = await resolvePublishPolicy(
      { status: 'active' },
      'merchant-1',
      { eventEndDate: end }
    );
    expect(result.active).toBe(true);
    expect(result.tier).toBe(2);
    expect(result.featured).toMatchObject({
      isFeatured: true,
      featuredType: 'temporary',
      priority: 97,
      endDate: end,
      reason: 'auto-trust-policy',
      createdBy: 'system-trust-policy',
    });
  });

  it('never auto-publishes when merchant is suspended', async () => {
    mockCountDocuments.mockResolvedValue(10);
    const result = await resolvePublishPolicy(
      { status: 'suspended' },
      'merchant-1',
      { eventEndDate: new Date('2030-01-01') }
    );
    expect(result.active).toBe(false);
    expect(result.featured).toBeNull();
    expect(result.tier).toBe(0);
    expect(result.completedCount).toBe(10);
  });

  it('never auto-publishes when merchant is missing', async () => {
    mockCountDocuments.mockResolvedValue(3);
    const result = await resolvePublishPolicy(null, 'merchant-1');
    expect(result.active).toBe(false);
    expect(result.tier).toBe(0);
  });

  it('buildAutoFeaturePayload builds temporary featured window', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-02-01T00:00:00.000Z');
    const payload = buildAutoFeaturePayload({ eventEndDate: end, now });
    expect(payload.startDate).toEqual(now);
    expect(payload.endDate).toEqual(end);
    expect(payload.isFeatured).toBe(true);
  });
});
