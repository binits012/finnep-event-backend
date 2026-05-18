/**
 * Monetary arithmetic: round to 2 decimals after every step (cents).
 */

export const roundMoney = (amount) => {
    if (amount === null || amount === undefined) return 0;
    const num = typeof amount === 'number' ? amount : parseFloat(String(amount));
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100) / 100;
};

export const moneyPercentOf = (base, ratePercent) => {
    return roundMoney(roundMoney(base) * (ratePercent / 100));
};

/** Tax on exact summed base (pricing_configuration seat aggregates). */
export const moneyPercentOfExactSum = (baseExact, ratePercent) => {
    return roundMoney(baseExact * (ratePercent / 100));
};

export const moneyAdd = (...amounts) => {
    return amounts.reduce((sum, part) => roundMoney(sum + roundMoney(part)), 0);
};

export const moneyMul = (unit, quantity) => {
    const qty = Math.max(0, Math.floor(quantity));
    return roundMoney(roundMoney(unit) * qty);
};

/**
 * @param {{
 *   basePrice: number,
 *   serviceFee?: number,
 *   vatRatePercent: number,
 *   serviceTaxRatePercent?: number,
 *   orderFee?: number,
 *   quantity: number,
 * }} input
 */
export const computeTicketLinePricing = (input) => {
    const quantity = Math.max(1, Math.floor(input.quantity));
    const basePrice = roundMoney(input.basePrice);
    const serviceFee = roundMoney(input.serviceFee ?? 0);
    const vatRatePercent = input.vatRatePercent;
    const serviceTaxRatePercent = input.serviceTaxRatePercent ?? 0;

    const perUnitSubtotal = moneyAdd(basePrice, serviceFee);
    const perUnitVat = moneyPercentOf(basePrice, vatRatePercent);
    const perUnitServiceTax =
        serviceFee > 0 && serviceTaxRatePercent > 0
            ? moneyPercentOf(serviceFee, serviceTaxRatePercent)
            : 0;
    const perUnitTotal = moneyAdd(perUnitSubtotal, perUnitVat, perUnitServiceTax);

    const totalBasePrice = moneyMul(basePrice, quantity);
    const totalServiceFee = moneyMul(serviceFee, quantity);
    const totalVatAmount = moneyMul(perUnitVat, quantity);
    const totalServiceTaxAmount = moneyMul(perUnitServiceTax, quantity);

    const orderFee = roundMoney(input.orderFee ?? 0);
    const orderFeeServiceTax =
        orderFee > 0 && serviceTaxRatePercent > 0
            ? moneyPercentOf(orderFee, serviceTaxRatePercent)
            : 0;

    const total = moneyAdd(
        moneyMul(perUnitTotal, quantity),
        orderFee,
        orderFeeServiceTax
    );

    return {
        basePrice,
        serviceFee,
        perUnitSubtotal,
        perUnitVat,
        perUnitServiceTax,
        perUnitTotal,
        totalBasePrice,
        totalServiceFee,
        totalVatAmount,
        totalServiceTaxAmount,
        orderFee,
        orderFeeServiceTax,
        total
    };
};

export const moneyToMetadataString = (amount) => {
    return roundMoney(amount).toFixed(2);
};
