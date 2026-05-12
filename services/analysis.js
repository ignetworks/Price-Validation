'use strict';

const { getVocLines, getPriorMrcForService } = require('./netsuite');

/**
 * Classify a variance percentage.
 * @param {number|null} variancePct - null means no prior rate found
 * @returns {string} NEW ITEM | MATCH | WARNING | MISMATCH
 */
function classify(variancePct) {
  if (variancePct === null || variancePct === undefined) return 'NEW ITEM';
  const abs = Math.abs(variancePct);
  if (abs < 0.5) return 'MATCH';
  if (abs <= 3) return 'WARNING';
  return 'MISMATCH';
}

/**
 * Analyze an array of vendor bills — fetch voclines, compare MRC, classify.
 * @param {Array} bills - array of bill objects from NetSuite
 * @returns {Promise<Array>} analysis results
 */
async function analyzeBills(bills) {
  const results = [];

  for (const bill of bills) {
    const billId = bill.id;
    const billRef = bill.otherRefNum || bill.tranId || `VENDBILL${bill.id}`;
    const vendor = bill.vendor?.refName || bill.vendor_name || 'Unknown';
    const currency = bill.currency?.refName || bill.currency || 'USD';
    const billDate = bill.tranDate
      ? (typeof bill.tranDate === 'string' ? bill.tranDate.slice(0, 10) : new Date(bill.tranDate).toISOString().slice(0, 10))
      : (bill.order_date ? String(bill.order_date).slice(0, 10) : '-');

    const lines = await getVocLines(billId);

    for (const line of lines) {
      const currentRate = line.rate;
      const prior = await getPriorMrcForService(line.itemId, billId, bill.tranDate);

      let variancePct = null;
      let varianceAmt = null;

      if (prior && prior.mrc !== 0) {
        varianceAmt = currentRate - prior.mrc;
        variancePct = ((currentRate - prior.mrc) / prior.mrc) * 100;
      }

      const status = classify(variancePct);

      results.push({
        status,
        billRef,
        billId: bill.tranId || `VENDBILL${bill.id}`,
        billDate,
        vendor,
        currency,
        vocItem: line.itemName || line.description || `Item #${line.itemId}`,
        vocItemId: line.itemId,
        currentRate,
        priorRate: prior ? prior.mrc : null,
        priorBillRef: prior ? `VENDBILL${prior.vocId}` : null,
        priorBillDate: prior ? (typeof prior.vocDate === 'string' ? prior.vocDate.slice(0, 10) : new Date(prior.vocDate).toISOString().slice(0, 10)) : null,
        variancePct,
        varianceAmt,
      });
    }
  }

  return results;
}

module.exports = { classify, analyzeBills };
