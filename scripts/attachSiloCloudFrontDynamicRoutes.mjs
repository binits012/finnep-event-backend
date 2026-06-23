#!/usr/bin/env node
/**
 * Attach the shared CloudFront viewer-request function to an existing silo distribution.
 * Use when a distribution was provisioned before dynamic route support was added.
 *
 * Usage:
 *   node scripts/attachSiloCloudFrontDynamicRoutes.mjs E1234567890ABC
 *   CLOUDFRONT_DISTRIBUTION_ID=E123... node scripts/attachSiloCloudFrontDynamicRoutes.mjs
 */
import { attachSiloCloudFrontDynamicRoutes } from '../util/siloDeploymentAws.js'

const distributionId = process.argv[2] || process.env.CLOUDFRONT_DISTRIBUTION_ID?.trim()

if (!distributionId) {
	console.error('Usage: node scripts/attachSiloCloudFrontDynamicRoutes.mjs <distribution-id>')
	process.exit(1)
}

try {
	await attachSiloCloudFrontDynamicRoutes(distributionId)
	console.log(`Attached dynamic event routes to ${distributionId}`)
} catch (err) {
	console.error(err?.message || err)
	process.exit(1)
}
