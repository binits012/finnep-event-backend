import * as Merchant from '../model/merchant.js';
import { info, error } from '../model/logger.js';
import * as consts from '../const.js';

// Helper to update nested fields in merchant
async function updateMerchant(merchantId, updateData) {
    return await Merchant.updateMerchantById(merchantId, updateData);
}

export const createPaytrailSubMerchant = async (req, res, next) => {
    try {
        // Admin only
        if (req.user.role !== 'admin') {
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                error: 'Admin access required'
            });
        }

        const { merchantId, bankingInfo, commissionRate } = req.body;

        // Get merchant
        const merchant = await Merchant.getMerchantById(merchantId);
        if (!merchant) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                error: 'Merchant not found'
            });
        }

        // Check if already has Paytrail sub-merchant
        if (merchant.paytrailSubMerchantId) {
            return res.status(consts.HTTP_STATUS_CONFLICT).json({
                error: 'Merchant already has Paytrail sub-merchant account',
                subMerchantId: merchant.paytrailSubMerchantId
            });
        }

        // Import Paytrail service
        const paytrailService = (await import('../services/paytrailService.js')).default;

        // Check if shop-in-shop is enabled
        const isShopInShopEnabled = await paytrailService.isShopInShopEnabled();

        if (!isShopInShopEnabled) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Shop-in-shop mode is not enabled. Enable it in settings or via PAYTRAIL_SHOP_IN_SHOP_ENABLED environment variable.'
            });
        }

        // Create sub-merchant in Paytrail
        const subMerchantData = {
            merchantName: merchant.name,
            businessId: merchant.code, // Business ID
            iban: bankingInfo.iban,
            bic: bankingInfo.bic,
            email: merchant.email,
            phone: merchant.phone,
            address: merchant.address
        };

        const paytrailResponse = await paytrailService.createSubMerchant(subMerchantData);

        // Get commission rate from request or use default
        const finalCommissionRate = commissionRate
            ? parseFloat(commissionRate)
            : parseFloat(process.env.PAYTRAIL_PLATFORM_COMMISSION || '3');

        // Validate commission rate
        if (finalCommissionRate < 0 || finalCommissionRate > 100) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Commission rate must be between 0 and 100'
            });
        }

        // Update merchant with sub-merchant ID
        await updateMerchant(merchantId, {
            paytrailSubMerchantId: paytrailResponse.id,
            paytrailEnabled: true,
            paytrailShopInShopData: {
                subMerchantName: merchant.name,
                commissionRate: finalCommissionRate, // Configurable per merchant
                createdAt: new Date(),
                status: 'active'
            },
            'bankingInfo.paytrail': {
                iban: bankingInfo.iban,
                bic: bankingInfo.bic,
                subMerchantId: paytrailResponse.id
            }
        });

        info(`Paytrail sub-merchant created for merchant ${merchantId}: ${paytrailResponse.id}`);

        res.status(consts.HTTP_STATUS_CREATED).json({
            success: true,
            subMerchantId: paytrailResponse.id,
            commissionRate: finalCommissionRate,
            message: 'Paytrail sub-merchant created successfully'
        });

    } catch (err) {
        error('Error creating Paytrail sub-merchant:', err);
        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            error: err.message
        });
    }
};

export const togglePaytrailForMerchant = async (req, res, next) => {
    try {
        // Admin only
        if (req.user.role !== 'admin') {
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                error: 'Admin access required'
            });
        }

        const { merchantId, enabled, commissionRate } = req.body;

        const merchant = await Merchant.getMerchantById(merchantId);
        if (!merchant) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                error: 'Merchant not found'
            });
        }

        const paytrailService = (await import('../services/paytrailService.js')).default;
        const isShopInShopEnabled = await paytrailService.isShopInShopEnabled();

        // In shop-in-shop mode, require sub-merchant ID when enabling
        if (isShopInShopEnabled && enabled && !merchant.paytrailSubMerchantId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Cannot enable Paytrail without sub-merchant account. Create sub-merchant first.'
            });
        }

        // In single account mode, no sub-merchant needed

        const updateData = {
            paytrailEnabled: enabled,
            'paytrailShopInShopData.status': enabled ? 'active' : 'suspended'
        };

        // Update commission rate if provided
        if (commissionRate !== undefined) {
            const rate = parseFloat(commissionRate);
            if (rate < 0 || rate > 100) {
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    error: 'Commission rate must be between 0 and 100'
                });
            }
            updateData['paytrailShopInShopData.commissionRate'] = rate;
        }

        await updateMerchant(merchantId, updateData);

        info(`Paytrail ${enabled ? 'enabled' : 'disabled'} for merchant ${merchantId}`);

        res.status(consts.HTTP_STATUS_OK).json({
            success: true,
            paytrailEnabled: enabled,
            commissionRate: updateData['paytrailShopInShopData.commissionRate'] || merchant.paytrailShopInShopData?.commissionRate
        });

    } catch (err) {
        error('Error toggling Paytrail for merchant:', err);
        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            error: err.message
        });
    }
};

export const toggleShopInShopMode = async (req, res, next) => {
    try {
        // Admin only
        if (req.user.role !== 'admin') {
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                error: 'Admin access required'
            });
        }

        const { enabled } = req.body;
        const Setting = await import('../model/setting.js');

        // Get latest setting or create new one
        const settings = await Setting.getSetting();
        let latestSetting = settings && settings.length > 0 ? settings[settings.length - 1] : null;

        if (!latestSetting) {
            // Create new setting with shop-in-shop toggle
            const otherInfo = new Map();
            otherInfo.set('paytrailShopInShopEnabled', enabled);
            latestSetting = await Setting.createSetting('', {}, {}, otherInfo);
        } else {
            // Update existing setting
            // Handle both Map and plain object cases
            let otherInfo;
            if (latestSetting.otherInfo) {
                if (typeof latestSetting.otherInfo.get === 'function') {
                    // It's a Map - convert to plain object for update
                    otherInfo = {};
                    latestSetting.otherInfo.forEach((value, key) => {
                        otherInfo[key] = value;
                    });
                } else {
                    // It's already a plain object
                    otherInfo = { ...latestSetting.otherInfo };
                }
            } else {
                otherInfo = {};
            }

            // Set the shop-in-shop enabled value
            otherInfo.paytrailShopInShopEnabled = enabled;

            latestSetting = await Setting.updateSettingById(latestSetting._id, {
                otherInfo: otherInfo
            });
        }

        info(`Paytrail shop-in-shop mode ${enabled ? 'enabled' : 'disabled'}`);

        res.status(consts.HTTP_STATUS_OK).json({
            success: true,
            shopInShopEnabled: enabled,
            message: `Shop-in-shop mode ${enabled ? 'enabled' : 'disabled'}`
        });

    } catch (err) {
        error('Error toggling shop-in-shop mode:', err);
        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            error: err.message
        });
    }
};
