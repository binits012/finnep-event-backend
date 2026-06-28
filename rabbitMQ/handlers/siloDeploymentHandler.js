import { info, error } from '../../model/logger.js'
import { Merchant as MerchantModel } from '../../model/mongoModel.js'
import { normalizeSiloSettings } from '../../util/siloSettings.js'
import {
	provisionSiloDeploymentAws,
	deprovisionSiloDeploymentAws,
	formatDeploymentError,
	getPlannedSiloBucketName
} from '../../util/siloDeploymentAws.js'
import { publishMerchantSiloDeploymentStatusChangedSafe } from '../../util/merchantEventPublisher.js'
import { syncSiloStorefrontAllowedDomains } from '../../model/merchant.js'

function buildDeploymentState(existing, patch) {
	return {
		...existing,
		...patch
	}
}

async function updateMerchantDeploymentState(merchant, patch) {
	const silo = normalizeSiloSettings(merchant.siloSettings || {})
	silo.deployment = buildDeploymentState(silo.deployment || {}, patch)
	merchant.siloSettings = silo
	merchant.updatedAt = new Date()
	await merchant.save()
	return merchant
}

async function publishStatus(merchant, action, status) {
	const silo = normalizeSiloSettings(merchant.siloSettings || {})
	await publishMerchantSiloDeploymentStatusChangedSafe({
		merchant,
		action,
		status,
		deployment: silo.deployment
	})
}

export async function handleSiloDeploymentRequest(message) {
	if (message?.eventType !== 'MerchantSiloDeploymentRequested') {
		return
	}

	const merchantId = message?.data?.merchantId != null ? String(message.data.merchantId) : null
	const action = message?.data?.action
	if (!merchantId || !['provision', 'deprovision'].includes(action)) {
		throw new Error('Invalid MerchantSiloDeploymentRequested payload')
	}

	const merchant = await MerchantModel.findOne({ merchantId })
	if (!merchant) {
		throw new Error(`Merchant not found for silo deployment request: ${merchantId}`)
	}

	const existingSilo = normalizeSiloSettings(merchant.siloSettings || {})

	try {
		const bucketName = existingSilo.deployment?.s3Bucket
			|| (action === 'provision' ? getPlannedSiloBucketName(merchantId) : '')

		await updateMerchantDeploymentState(merchant, {
			mode: 'per_merchant',
			status: action === 'provision' ? 'provisioning' : 'deprovisioning',
			lastProvisionRequestedAt: new Date().toISOString(),
			lastError: '',
			...(bucketName ? { s3Bucket: bucketName } : {})
		})

		const result = action === 'provision'
			? await provisionSiloDeploymentAws({
				merchantId,
				existingDeployment: existingSilo.deployment || {}
			})
			: await deprovisionSiloDeploymentAws({
				merchantId,
				existingDeployment: existingSilo.deployment || {}
			})

		await updateMerchantDeploymentState(merchant, result)
		if (action === 'provision' && result.status === 'provisioned') {
			await syncSiloStorefrontAllowedDomains(merchant._id)
		}
		await publishStatus(merchant, action, result.status)

		info('Handled MerchantSiloDeploymentRequested', {
			merchantId,
			action,
			status: result.status
		})
	} catch (handlerError) {
		const failureStatus = action === 'provision' ? 'provision_failed' : 'deprovision_failed'
		await updateMerchantDeploymentState(merchant, {
			mode: 'per_merchant',
			status: failureStatus,
			lastError: formatDeploymentError(handlerError)
		})
		await publishStatus(merchant, action, failureStatus)

		error('Failed MerchantSiloDeploymentRequested', {
			merchantId,
			action,
			error: handlerError.message
		})
		throw handlerError
	}
}
