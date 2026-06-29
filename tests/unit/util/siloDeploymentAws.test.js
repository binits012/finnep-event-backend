import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
	API_CACHE_FORWARDED_HEADERS,
	resolveSiloBucketNameForProvision,
} from '../../../util/siloDeploymentAws.js';

describe('siloDeploymentAws', () => {
	it('API_CACHE_FORWARDED_HEADERS has no Host (CloudFront rejects it on cache behaviors)', () => {
		expect(API_CACHE_FORWARDED_HEADERS).not.toContain('Host');
		expect(API_CACHE_FORWARDED_HEADERS.length).toBe(6);
	});

	describe('resolveSiloBucketNameForProvision', () => {
		const prevPrefix = process.env.SILO_DEPLOYMENT_BUCKET_PREFIX;
		const prevBucket = process.env.BUCKET_NAME;

		beforeEach(() => {
			process.env.SILO_DEPLOYMENT_BUCKET_PREFIX = 'okazzo-eu';
			delete process.env.BUCKET_NAME;
		});

		afterEach(() => {
			if (prevPrefix === undefined) delete process.env.SILO_DEPLOYMENT_BUCKET_PREFIX;
			else process.env.SILO_DEPLOYMENT_BUCKET_PREFIX = prevPrefix;
			if (prevBucket === undefined) delete process.env.BUCKET_NAME;
			else process.env.BUCKET_NAME = prevBucket;
		});

		it('uses planned bucket on failed provision even when stored prefix differs', () => {
			const bucket = resolveSiloBucketNameForProvision('1000000000000000004', {
				s3Bucket: 'okazzo-aus-1000000000000000004',
				status: 'provision_failed',
			});
			expect(bucket).toBe('okazzo-eu-1000000000000000004');
		});

		it('keeps stored bucket for live provisioned deployment', () => {
			const bucket = resolveSiloBucketNameForProvision('1000000000000000004', {
				s3Bucket: 'okazzo-aus-1000000000000000004',
				status: 'provisioned',
				lastProvisionedAt: '2026-01-01T00:00:00.000Z',
				cloudfrontDistributionId: 'E123',
			});
			expect(bucket).toBe('okazzo-aus-1000000000000000004');
		});
	});
});
