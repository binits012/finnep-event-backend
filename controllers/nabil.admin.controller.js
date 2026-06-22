import * as Merchant from '../model/merchant.js';
import { info, error } from '../model/logger.js';
import * as consts from '../const.js';
import { isNepalCountry } from '../util/nepalPayment.js';
import { publishMerchantNabilToggledSafe } from '../util/merchantEventPublisher.js';

export const toggleNabilForMerchant = async (req, res) => {
    try {
        const { merchantId, enabled } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'enabled must be a boolean'
            });
        }

        const merchant = await Merchant.getMerchantById(merchantId);
        if (!merchant) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                error: 'Merchant not found'
            });
        }

        if (enabled && !isNepalCountry(merchant.country)) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Nabil payments can only be enabled for Nepal merchants'
            });
        }

        await Merchant.updateMerchantById(merchantId, {
            nabilEnabled: enabled
        });

        await publishMerchantNabilToggledSafe({
            merchant,
            nabilEnabled: enabled,
            updatedBy: req.user.userId
        });

        info(`Nabil ${enabled ? 'enabled' : 'disabled'} for merchant ${merchant.merchantId}`);

        res.status(consts.HTTP_STATUS_OK).json({
            success: true,
            nabilEnabled: enabled
        });
    } catch (err) {
        error('Error toggling Nabil for merchant:', err);
        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            error: err.message
        });
    }
};
