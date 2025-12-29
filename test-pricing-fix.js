// Test script to verify the pricing fix for different placeId formats
function testTierExtraction() {
    const placeIds = ["000002", "000000", "000001"];

    placeIds.forEach(placeId => {
        console.log(`\nTesting placeId: ${placeId}`);
        console.log(`Length: ${placeId.length}`);

        let tierCode = null;

        // Check new format first (with | separators)
        if (placeId.includes('|')) {
            const parts = placeId.split('|');
            if (parts.length === 3) {
                tierCode = parts[1];
                console.log(`New format - tierCode: "${tierCode}"`);
            }
        }
        // Old format: VENUE_PREFIX(4) + SECTION_CHAR(1) + TIER_CODE(1) + POSITION_CODE(rest)
        else if (placeId.length >= 6) {
            tierCode = placeId.substring(5, 6); // Position 5 is the tier code
            console.log(`Old format - tierCode: "${tierCode}"`);
        }

        // Mock tierMap - let's assume tier '2' exists
        const tierMap = new Map([
            ['0', { id: '0', basePrice: 25, tax: 10, serviceFee: 2, serviceTax: 0 }],
            ['1', { id: '1', basePrice: 30, tax: 10, serviceFee: 3, serviceTax: 0 }],
            ['2', { id: '2', basePrice: 35, tax: 10, serviceFee: 4, serviceTax: 0 }]
        ]);

        if (tierCode !== null) {
            const tier = tierMap.get(tierCode);
            if (tier) {
                const pricing = {
                    basePrice: tier.basePrice || 0,
                    currency: 'EUR',
                    serviceFee: tier.serviceFee || 0,
                    tax: tier.tax || 0,
                    serviceTax: tier.serviceTax || 0,
                    orderFee: 5 // example orderFee
                };
                console.log('Found pricing from tier:', pricing);
            } else {
                console.log(`Tier not found for tierCode: ${tierCode}, available tiers: ${Array.from(tierMap.keys()).join(', ')}`);
                console.log('Would fall back to place pricing or default zeros');
            }
        } else {
            console.log('No tierCode extracted, would fall back to place pricing');
        }
    });
}

testTierExtraction();
