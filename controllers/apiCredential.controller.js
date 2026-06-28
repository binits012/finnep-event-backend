import * as consts from '../const.js'
import * as Merchant from '../model/merchant.js'
import { error } from '../model/logger.js'
import { INTERNAL_SERVER_ERROR, RESOURCE_NOT_FOUND } from '../applicationTexts.js'
import { refreshPartnerCorsOriginsFromMerchants } from '../util/corsAllowlist.js'
import {
	publishMerchantSiloProvisionedSafe,
	publishMerchantSiloDeploymentRequestedSafe,
	publishMerchantSiloDeploymentStatusChangedSafe
} from '../util/merchantEventPublisher.js'
import { normalizeSiloSettings, getSiloHostingSummaryForAdmin } from '../util/siloSettings.js'
import * as model from '../model/mongoModel.js'

async function loadSiloHostingSummary(merchantId) {
	const merchant = await model.Merchant.findById(merchantId).lean()
	if (!merchant) return null
	return getSiloHostingSummaryForAdmin(merchant.siloSettings, merchant.apiCredentials)
}

async function notifySiloProvisioned(merchantId, updatedBy) {
	const merchant = await model.Merchant.findById(merchantId).lean()
	if (!merchant) return
	const siloEnabled = Boolean(normalizeSiloSettings(merchant.siloSettings || {}).enabled)
	await publishMerchantSiloProvisionedSafe({
		merchant,
		siloEnabled,
		updatedBy,
	})
}

async function notifySiloDeploymentRequest(merchantId, deploymentAction, updatedBy) {
	if (!deploymentAction) return
	const merchant = await model.Merchant.findById(merchantId).lean()
	if (!merchant) return
	await publishMerchantSiloDeploymentRequestedSafe({
		merchant,
		action: deploymentAction,
		updatedBy,
	})
}

export const issueApiCredential = async (req, res) => {
	try {
		const merchantId = req.params.id
		const { allowedDomains = [], scopes = [], label = '', serverToServer = false } = req.body || {}

		if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'allowedDomains is required and must be a non-empty array',
				error: 'INVALID_ALLOWED_DOMAINS'
			})
		}

		const result = await Merchant.issueApiCredential(merchantId, {
			allowedDomains,
			scopes,
			label,
			serverToServer
		})
		if (!result) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}

		await refreshPartnerCorsOriginsFromMerchants()
		await notifySiloProvisioned(merchantId, req.user?.email || 'cms-api-credentials')
		await notifySiloDeploymentRequest(
			merchantId,
			result.deploymentAction,
			req.user?.email || 'cms-api-credentials'
		)
		return res.status(consts.HTTP_STATUS_CREATED).json({
			credential: result.credential,
			secret: result.secret
		})
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const listApiCredentials = async (req, res) => {
	try {
		const credentials = await Merchant.listApiCredentials(req.params.id)
		if (credentials === null) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}

		const reconcile = await Merchant.reconcileSiloProvisionedFromCredentials(req.params.id)
		if (reconcile.changed) {
			await notifySiloProvisioned(req.params.id, req.user?.email || 'cms-api-credentials-reconcile')
			await notifySiloDeploymentRequest(
				req.params.id,
				reconcile.deploymentAction,
				req.user?.email || 'cms-api-credentials-reconcile'
			)
		}

		const retry = await Merchant.retryFailedSiloDeploymentIfNeeded(req.params.id)
		if (retry.retried) {
			await notifySiloDeploymentRequest(
				req.params.id,
				retry.deploymentAction,
				req.user?.email || 'cms-api-credentials-retry'
			)
		}

		const siloHosting = await loadSiloHostingSummary(req.params.id)

		return res.status(consts.HTTP_STATUS_OK).json({ credentials, siloHosting })
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const rotateApiCredential = async (req, res) => {
	try {
		const result = await Merchant.rotateApiCredential(req.params.id, req.params.keyId)
		if (!result) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		return res.status(consts.HTTP_STATUS_OK).json({
			credential: result.credential,
			secret: result.secret
		})
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const updateApiCredential = async (req, res) => {
	try {
		const result = await Merchant.updateApiCredential(req.params.id, req.params.keyId, req.body || {})
		if (!result) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		await refreshPartnerCorsOriginsFromMerchants()
		if (req.body?.status === 'revoked') {
			await notifySiloProvisioned(req.params.id, req.user?.email || 'cms-api-credentials')
		}
		await notifySiloDeploymentRequest(
			req.params.id,
			result.deploymentAction,
			req.user?.email || 'cms-api-credentials'
		)
		return res.status(consts.HTTP_STATUS_OK).json({ credential: result.credential })
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const revokeApiCredential = async (req, res) => {
	try {
		const result = await Merchant.revokeApiCredential(req.params.id, req.params.keyId)
		if (!result) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		await refreshPartnerCorsOriginsFromMerchants()
		await notifySiloProvisioned(req.params.id, req.user?.email || 'cms-api-credentials')
		await notifySiloDeploymentRequest(
			req.params.id,
			result.deploymentAction,
			req.user?.email || 'cms-api-credentials'
		)
		return res.status(consts.HTTP_STATUS_OK).json({ credential: result.credential })
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}

export const retrySiloDeployment = async (req, res) => {
	try {
		const merchantId = req.params.id
		const updatedBy = req.user?.email || 'cms-silo-deployment-retry'

		const reconcile = await Merchant.reconcileSiloProvisioningFromAws(merchantId)
		if (!reconcile) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND })
		}
		if (reconcile.error === 'SILO_NOT_ENABLED') {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Issue active API credentials before retrying silo hosting provisioning',
				error: 'SILO_NOT_ENABLED'
			})
		}

		if (reconcile.reconciled) {
			await publishMerchantSiloDeploymentStatusChangedSafe({
				merchant: reconcile.merchant,
				action: 'provision',
				status: 'provisioned',
				deployment: reconcile.deployment
			})

			const siloHosting = await loadSiloHostingSummary(merchantId)
			return res.status(consts.HTTP_STATUS_OK).json({
				reconciled: true,
				siloHosting
			})
		}

		const result = await Merchant.requeueSiloProvisioning(merchantId)
		await notifySiloDeploymentRequest(
			merchantId,
			result.deploymentAction,
			updatedBy
		)

		const siloHosting = await loadSiloHostingSummary(merchantId)
		return res.status(consts.HTTP_STATUS_OK).json({
			retried: true,
			siloHosting,
			reconcileIssues: reconcile.issues || []
		})
	} catch (err) {
		error(err)
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR })
	}
}
