import {
	S3Client,
	HeadBucketCommand,
	CreateBucketCommand,
	GetBucketLocationCommand,
	PutBucketPolicyCommand
} from '@aws-sdk/client-s3'
import {
	CloudFrontClient,
	CreateDistributionCommand,
	CreateFunctionCommand,
	CreateOriginAccessControlCommand,
	DescribeFunctionCommand,
	GetDistributionCommand,
	GetDistributionConfigCommand,
	ListDistributionsCommand,
	ListOriginAccessControlsCommand,
	PublishFunctionCommand,
	UpdateDistributionCommand,
	UpdateFunctionCommand
} from '@aws-sdk/client-cloudfront'
import { error, info, warn } from '../model/logger.js'
import { getSiloBffOriginSecret, SILO_CF_ATTESTATION_HEADER } from './siloBffOriginGuard.js'
import { getSiloStorefrontBffOriginHostname, SILO_STOREFRONT_BFF_PUBLIC_PATH } from './siloStorefrontBffProxy.js'
import {
	SILO_CLOUDFRONT_DYNAMIC_ROUTES_FUNCTION_NAME,
	SILO_CLOUDFRONT_DYNAMIC_ROUTES_SOURCE
} from './siloCloudFrontDynamicRoutes.js'

const DEFAULT_REGION = process.env.SILO_DEPLOYMENT_AWS_REGION
	|| process.env.AWS_REGION
	|| process.env.BUCKET_REGION
	|| 'eu-central-1'
const BUCKET_PREFIX = (
	process.env.SILO_DEPLOYMENT_BUCKET_PREFIX
	|| process.env.BUCKET_NAME
	|| 'okazzo-silo'
).trim().toLowerCase()
const PRICE_CLASS = process.env.SILO_DEPLOYMENT_CLOUDFRONT_PRICE_CLASS || 'PriceClass_100'

function resolveAwsCredentials() {
	const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.BUCKET_ACCESS_CLIENT
	const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.BUCKET_ACCESS_KEY
	const sessionToken = process.env.AWS_SESSION_TOKEN || process.env.BUCKET_SESSION_TOKEN
	if (!accessKeyId || !secretAccessKey) return undefined
	return {
		accessKeyId,
		secretAccessKey,
		...(sessionToken ? { sessionToken } : {})
	}
}

const awsCredentials = resolveAwsCredentials()

if (!awsCredentials) {
	warn(
		'[siloDeploymentAws] AWS credentials not found. Expected AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or BUCKET_ACCESS_CLIENT/BUCKET_ACCESS_KEY.'
	)
}

function assertAwsCredentials() {
	if (awsCredentials) return
	throw new Error(
		'Missing AWS credentials for silo deployment. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or BUCKET_ACCESS_CLIENT/BUCKET_ACCESS_KEY.'
	)
}

const s3Client = new S3Client({
	region: DEFAULT_REGION,
	...(awsCredentials ? { credentials: awsCredentials } : {})
})

const cloudFrontClient = new CloudFrontClient({
	region: 'us-east-1',
	...(awsCredentials ? { credentials: awsCredentials } : {})
})

function sanitizeBucketName(name) {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63)
}

function sanitizeOacName(name) {
	return name
		.replace(/[^a-zA-Z0-9-_]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64)
}

function buildBucketName(merchantId) {
	return sanitizeBucketName(`${BUCKET_PREFIX}-${merchantId}`)
}

export function getPlannedSiloBucketName(merchantId) {
	return buildBucketName(merchantId)
}

function buildOacName(merchantId) {
	return sanitizeOacName(`silo-oac-${merchantId}`)
}

function buildS3OriginDomain(bucketName, region) {
	if (!region || region === 'us-east-1') {
		return `${bucketName}.s3.amazonaws.com`
	}
	return `${bucketName}.s3.${region}.amazonaws.com`
}

async function resolveBucketRegion(bucketName) {
	try {
		const response = await s3Client.send(new GetBucketLocationCommand({ Bucket: bucketName }))
		const location = response?.LocationConstraint
		if (!location || location === '') return 'us-east-1'
		return location
	} catch (err) {
		warn('[siloDeploymentAws] Could not resolve bucket region, using default', {
			bucketName,
			error: err?.message
		})
		return DEFAULT_REGION
	}
}

async function ensureBucketExists(bucketName, region) {
	try {
		await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }))
		return
	} catch {
		// Bucket does not exist or is not accessible with this account.
	}

	const createParams = { Bucket: bucketName }
	if (region !== 'us-east-1') {
		createParams.CreateBucketConfiguration = { LocationConstraint: region }
	}
	try {
		await s3Client.send(new CreateBucketCommand(createParams))
	} catch (err) {
		const errorCode = err?.name || err?.Code || ''
		if (errorCode !== 'BucketAlreadyExists' && errorCode !== 'BucketAlreadyOwnedByYou') {
			throw err
		}
	}
}

async function ensureOriginAccessControl(merchantId) {
	const name = buildOacName(merchantId)
	let marker
	while (true) {
		const response = await cloudFrontClient.send(
			new ListOriginAccessControlsCommand(marker ? { Marker: marker } : {})
		)
		const list = response?.OriginAccessControlList
		const items = list?.Items || []
		const match = items.find((item) => item.Name === name)
		if (match?.Id) return match.Id
		if (!list?.IsTruncated || !list?.NextMarker) break
		marker = list.NextMarker
	}

	const created = await cloudFrontClient.send(
		new CreateOriginAccessControlCommand({
			OriginAccessControlConfig: {
				Name: name,
				Description: `Silo storefront OAC for merchant ${merchantId}`,
				SigningProtocol: 'sigv4',
				SigningBehavior: 'always',
				OriginAccessControlOriginType: 's3'
			}
		})
	)
	const oacId = created?.OriginAccessControl?.Id
	if (!oacId) {
		throw new Error(`Failed to create Origin Access Control for merchant ${merchantId}`)
	}
	return oacId
}

async function applyCloudFrontBucketPolicy(bucketName, distributionArn) {
	if (!distributionArn) return

	const policy = {
		Version: '2012-10-17',
		Statement: [
			{
				Sid: 'AllowCloudFrontServicePrincipalReadOnly',
				Effect: 'Allow',
				Principal: {
					Service: 'cloudfront.amazonaws.com'
				},
				Action: ['s3:GetObject'],
				Resource: `arn:aws:s3:::${bucketName}/*`,
				Condition: {
					StringEquals: {
						'AWS:SourceArn': distributionArn
					}
				}
			}
		]
	}
	await s3Client.send(
		new PutBucketPolicyCommand({
			Bucket: bucketName,
			Policy: JSON.stringify(policy)
		})
	)
}

async function findDistributionByComment(comment) {
	let marker
	while (true) {
		const response = await cloudFrontClient.send(
			new ListDistributionsCommand(marker ? { Marker: marker } : {})
		)
		const list = response?.DistributionList
		const items = list?.Items || []
		const match = items.find((item) => item.Comment === comment)
		if (match) return match
		if (!list?.IsTruncated || !list?.NextMarker) break
		marker = list.NextMarker
	}
	return null
}

function buildBffOriginCustomHeaders(merchantId) {
	const items = [{
		HeaderName: 'X-Silo-Merchant-Id',
		HeaderValue: String(merchantId)
	}]
	const attestationSecret = getSiloBffOriginSecret()
	if (attestationSecret) {
		items.push({
			HeaderName: SILO_CF_ATTESTATION_HEADER,
			HeaderValue: attestationSecret
		})
	}
	return { Quantity: items.length, Items: items }
}

function buildBffOrigin(merchantId) {
	const hostname = getSiloStorefrontBffOriginHostname()
	if (!hostname) return null
	return {
		Id: `silo-bff-${merchantId}`,
		DomainName: hostname,
		OriginPath: SILO_STOREFRONT_BFF_PUBLIC_PATH,
		OriginCustomHeaders: buildBffOriginCustomHeaders(merchantId),
		CustomOriginConfig: {
			HTTPPort: 80,
			HTTPSPort: 443,
			OriginProtocolPolicy: 'https-only',
			OriginSslProtocols: { Quantity: 1, Items: ['TLSv1.2'] },
			OriginReadTimeout: 30,
			OriginKeepaliveTimeout: 5
		}
	}
}

function buildApiCacheBehavior(bffOriginId) {
	return {
		PathPattern: '/api/*',
		TargetOriginId: bffOriginId,
		ViewerProtocolPolicy: 'redirect-to-https',
		AllowedMethods: {
			Quantity: 7,
			Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
			CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] }
		},
		ForwardedValues: {
			QueryString: true,
			Headers: {
				Quantity: 7,
				Items: ['Origin', 'Referer', 'Host', 'Content-Type', 'Accept', 'Authorization', 'x-market-country-code']
			},
			Cookies: { Forward: 'none' },
			QueryStringCacheKeys: { Quantity: 0 }
		},
		MinTTL: 0,
		DefaultTTL: 0,
		MaxTTL: 0,
		Compress: true,
		TrustedSigners: { Enabled: false, Quantity: 0 },
		TrustedKeyGroups: { Enabled: false, Quantity: 0 }
	}
}

async function ensureDistributionApiBehavior({ distributionId, merchantId }) {
	const bffOrigin = buildBffOrigin(merchantId)
	if (!bffOrigin || !distributionId) return

	const configResponse = await cloudFrontClient.send(
		new GetDistributionConfigCommand({ Id: distributionId })
	)
	const config = configResponse?.DistributionConfig
	if (!config) return

	const origins = [...(config.Origins?.Items || [])]
	const existingOriginIndex = origins.findIndex((origin) => origin.Id === bffOrigin.Id)
	if (existingOriginIndex === -1) {
		origins.push(bffOrigin)
	} else {
		origins[existingOriginIndex] = {
			...origins[existingOriginIndex],
			OriginCustomHeaders: bffOrigin.OriginCustomHeaders
		}
	}
	config.Origins = { Quantity: origins.length, Items: origins }

	const cacheBehaviors = [...(config.CacheBehaviors?.Items || [])]
	const apiBehaviorIndex = cacheBehaviors.findIndex((behavior) => behavior.PathPattern === '/api/*')
	if (apiBehaviorIndex === -1) {
		cacheBehaviors.unshift(buildApiCacheBehavior(bffOrigin.Id))
	} else {
		cacheBehaviors[apiBehaviorIndex] = buildApiCacheBehavior(bffOrigin.Id)
	}
	config.CacheBehaviors = {
		Quantity: cacheBehaviors.length,
		Items: cacheBehaviors
	}

	await cloudFrontClient.send(
		new UpdateDistributionCommand({
			Id: distributionId,
			IfMatch: configResponse.ETag,
			DistributionConfig: config
		})
	)

	info('CloudFront /api/* behavior configured for silo BFF', {
		distributionId,
		merchantId,
		bffOrigin: bffOrigin.DomainName
	})
}

function isNoSuchCloudFrontFunctionError(err) {
	const code = err?.name || err?.Code || err?.code
	return code === 'NoSuchFunctionExists' || code === 'NoSuchFunction'
}

async function ensurePublishedDynamicRoutesFunctionArn() {
	const name = SILO_CLOUDFRONT_DYNAMIC_ROUTES_FUNCTION_NAME
	const functionCode = Buffer.from(SILO_CLOUDFRONT_DYNAMIC_ROUTES_SOURCE, 'utf8')
	const functionConfig = {
		Comment: 'Rewrite silo storefront /events/:id URLs to static shell HTML',
		Runtime: 'cloudfront-js-2.0'
	}

	let etag
	try {
		const described = await cloudFrontClient.send(new DescribeFunctionCommand({ Name: name }))
		etag = described.ETag
		await cloudFrontClient.send(new UpdateFunctionCommand({
			Name: name,
			IfMatch: etag,
			FunctionConfig: functionConfig,
			FunctionCode: functionCode
		}))
		const updated = await cloudFrontClient.send(new DescribeFunctionCommand({ Name: name }))
		etag = updated.ETag
	} catch (err) {
		if (!isNoSuchCloudFrontFunctionError(err)) throw err
		const created = await cloudFrontClient.send(new CreateFunctionCommand({
			Name: name,
			FunctionConfig: functionConfig,
			FunctionCode: functionCode
		}))
		etag = created.ETag
	}

	const published = await cloudFrontClient.send(new PublishFunctionCommand({
		Name: name,
		IfMatch: etag
	}))

	const arn = published?.FunctionSummary?.FunctionMetadata?.FunctionARN
	if (!arn) {
		throw new Error(`Failed to publish CloudFront function: ${name}`)
	}

	info('CloudFront dynamic event routes function published', { name, arn })
	return arn
}

async function ensureDistributionDynamicRoutesFunction(distributionId) {
	if (!distributionId) return

	const functionArn = await ensurePublishedDynamicRoutesFunctionArn()
	const configResponse = await cloudFrontClient.send(
		new GetDistributionConfigCommand({ Id: distributionId })
	)
	const config = configResponse?.DistributionConfig
	if (!config?.DefaultCacheBehavior) return

	const behavior = { ...config.DefaultCacheBehavior }
	const items = [...(behavior.FunctionAssociations?.Items || [])]
	const withoutViewerRequest = items.filter((item) => item.EventType !== 'viewer-request')
	withoutViewerRequest.push({
		EventType: 'viewer-request',
		FunctionARN: functionArn
	})
	behavior.FunctionAssociations = {
		Quantity: withoutViewerRequest.length,
		Items: withoutViewerRequest
	}
	config.DefaultCacheBehavior = behavior

	await cloudFrontClient.send(
		new UpdateDistributionCommand({
			Id: distributionId,
			IfMatch: configResponse.ETag,
			DistributionConfig: config
		})
	)

	info('CloudFront viewer-request function attached for dynamic event URLs', {
		distributionId,
		functionArn
	})
}

async function ensureDistribution({ bucketName, bucketRegion, merchantId, existingDistributionId, oacId }) {
	const bffOrigin = buildBffOrigin(merchantId)

	if (existingDistributionId) {
		const existing = await cloudFrontClient.send(
			new GetDistributionCommand({ Id: existingDistributionId })
		)
		await ensureDistributionApiBehavior({
			distributionId: existingDistributionId,
			merchantId
		})
		await ensureDistributionDynamicRoutesFunction(existingDistributionId)
		return {
			id: existingDistributionId,
			domainName: existing?.Distribution?.DomainName || '',
			arn: existing?.Distribution?.ARN || ''
		}
	}

	const comment = `silo-merchant-${merchantId}`
	const existingByComment = await findDistributionByComment(comment)
	if (existingByComment?.Id) {
		const existing = await cloudFrontClient.send(
			new GetDistributionCommand({ Id: existingByComment.Id })
		)
		await ensureDistributionApiBehavior({
			distributionId: existingByComment.Id,
			merchantId
		})
		await ensureDistributionDynamicRoutesFunction(existingByComment.Id)
		return {
			id: existingByComment.Id,
			domainName: existingByComment.DomainName || existing?.Distribution?.DomainName || '',
			arn: existing?.Distribution?.ARN || ''
		}
	}

	const functionArn = await ensurePublishedDynamicRoutesFunctionArn()
	const originId = `silo-s3-${merchantId}`
	const originDomain = buildS3OriginDomain(bucketName, bucketRegion)
	const originItems = [
		{
			Id: originId,
			DomainName: originDomain,
			OriginAccessControlId: oacId,
			S3OriginConfig: {
				OriginAccessIdentity: ''
			}
		}
	]
	if (bffOrigin) {
		originItems.push(bffOrigin)
	}

	const distribution = await cloudFrontClient.send(
		new CreateDistributionCommand({
			DistributionConfig: {
				CallerReference: `${comment}-${Date.now()}`,
				Comment: comment,
				Enabled: true,
				PriceClass: PRICE_CLASS,
				DefaultRootObject: 'index.html',
				Origins: {
					Quantity: originItems.length,
					Items: originItems
				},
				...(bffOrigin ? {
					CacheBehaviors: {
						Quantity: 1,
						Items: [buildApiCacheBehavior(bffOrigin.Id)]
					}
				} : {}),
				DefaultCacheBehavior: {
					TargetOriginId: originId,
					ViewerProtocolPolicy: 'redirect-to-https',
					AllowedMethods: {
						Quantity: 2,
						Items: ['GET', 'HEAD'],
						CachedMethods: {
							Quantity: 2,
							Items: ['GET', 'HEAD']
						}
					},
					ForwardedValues: {
						QueryString: false,
						Cookies: { Forward: 'none' }
					},
					TrustedSigners: { Enabled: false, Quantity: 0 },
					TrustedKeyGroups: { Enabled: false, Quantity: 0 },
					Compress: true,
					MinTTL: 0,
					FunctionAssociations: {
						Quantity: 1,
						Items: [{
							EventType: 'viewer-request',
							FunctionARN: functionArn
						}]
					}
				}
			}
		})
	)

	return {
		id: distribution?.Distribution?.Id || '',
		domainName: distribution?.Distribution?.DomainName || '',
		arn: distribution?.Distribution?.ARN || ''
	}
}

async function disableDistribution(distributionId) {
	if (!distributionId) return
	const configResponse = await cloudFrontClient.send(
		new GetDistributionConfigCommand({ Id: distributionId })
	)
	const config = configResponse?.DistributionConfig
	if (!config || config.Enabled === false) return
	config.Enabled = false
	await cloudFrontClient.send(
		new UpdateDistributionCommand({
			Id: distributionId,
			IfMatch: configResponse.ETag,
			DistributionConfig: config
		})
	)
}

export async function attachSiloCloudFrontDynamicRoutes(distributionId) {
	assertAwsCredentials()
	if (!distributionId) {
		throw new Error('cloudfrontDistributionId is required')
	}
	await ensureDistributionDynamicRoutesFunction(distributionId)
}

export async function provisionSiloDeploymentAws({ merchantId, existingDeployment = {} }) {
	assertAwsCredentials()
	const bucketName = existingDeployment.s3Bucket || buildBucketName(merchantId)
	await ensureBucketExists(bucketName, DEFAULT_REGION)
	const bucketRegion = await resolveBucketRegion(bucketName)
	const oacId = await ensureOriginAccessControl(merchantId)
	const distribution = await ensureDistribution({
		bucketName,
		bucketRegion,
		merchantId,
		existingDistributionId: existingDeployment.cloudfrontDistributionId,
		oacId
	})
	await applyCloudFrontBucketPolicy(bucketName, distribution.arn)

	info('Silo AWS provisioned', {
		merchantId,
		bucketName,
		bucketRegion,
		originDomain: buildS3OriginDomain(bucketName, bucketRegion),
		cloudfrontDistributionId: distribution.id
	})

	return {
		mode: 'per_merchant',
		status: 'provisioned',
		s3Bucket: bucketName,
		s3Region: bucketRegion,
		cloudfrontDistributionId: distribution.id,
		cloudfrontDomainName: distribution.domainName,
		lastProvisionedAt: new Date().toISOString(),
		lastError: ''
	}
}

export async function deprovisionSiloDeploymentAws({ merchantId, existingDeployment = {} }) {
	assertAwsCredentials()
	if (existingDeployment.cloudfrontDistributionId) {
		await disableDistribution(existingDeployment.cloudfrontDistributionId)
	}

	info('Silo AWS deprovision requested', {
		merchantId,
		cloudfrontDistributionId: existingDeployment.cloudfrontDistributionId || null
	})

	return {
		mode: 'per_merchant',
		status: 'deprovisioned',
		s3Bucket: existingDeployment.s3Bucket || '',
		s3Region: existingDeployment.s3Region || DEFAULT_REGION,
		cloudfrontDistributionId: existingDeployment.cloudfrontDistributionId || '',
		cloudfrontDomainName: existingDeployment.cloudfrontDomainName || '',
		lastError: ''
	}
}

export function formatDeploymentError(err) {
	if (!err) return 'Unknown deployment error'
	return String(err?.message || err).slice(0, 1000)
}
