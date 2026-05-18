'use strict';

const { getVocLines, getPriorMrcForService } = require('./netsuite');

// Skip ICMS lines — Brazilian tax, not a real price signal (per Andrea)
const ICMS_PATTERN = /\bicms\b/i;

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
  // Group across all bills by VOC line (item id) so the same VOC line on
  // multiple bills in the query period is summed into a single comparison row.
  const groups = new Map();

  for (const bill of bills) {
    const billRef = bill.otherRefNum || bill.tranId || `VENDBILL${bill.id}`;
    const vendor = bill.vendor?.refName || bill.vendor_name || 'Unknown';
    const currency = bill.currency?.refName || bill.currency || 'USD';
    const billDate = bill.tranDate
      ? (typeof bill.tranDate === 'string' ? bill.tranDate.slice(0, 10) : new Date(bill.tranDate).toISOString().slice(0, 10))
      : (bill.order_date ? String(bill.order_date).slice(0, 10) : '-');

    const lines = await getVocLines(bill.id);

    for (const line of lines) {
      const haystack = `${line.itemCode || ''} ${line.itemName || ''} ${line.description || ''}`;
      if (ICMS_PATTERN.test(haystack)) continue;
      if (!line.itemId) continue;

      const amount = line.amount || (line.rate * line.quantity) || 0;
      const existing = groups.get(line.itemId);
      if (existing) {
        existing.totalAmount += amount;
        existing.billRefs.add(billRef);
        existing.vendors.add(vendor);
        if (billDate > existing.latestDate) {
          existing.latestDate = billDate;
          existing.latestBillId = bill.id;
          existing.latestTranDate = bill.tranDate;
        }
        if (billDate < existing.earliestTranDate) existing.earliestTranDate = bill.tranDate;
      } else {
        groups.set(line.itemId, {
          itemId: line.itemId,
          itemCode: line.itemCode || null,
          totalAmount: amount,
          billRefs: new Set([billRef]),
          vendors: new Set([vendor]),
          currency,
          latestDate: billDate,
          latestBillId: bill.id,
          latestTranDate: bill.tranDate,
          earliestTranDate: bill.tranDate,
        });
      }
    }
  }

  const results = [];
  for (const group of groups.values()) {
    if (group.totalAmount === 0) continue;

    const currentRate = group.totalAmount;
    // Use the earliest current-bill date as the prior cutoff so no current bill
    // can leak in as a "prior" when the same VOC line spans multiple bills.
    const prior = await getPriorMrcForService(group.itemId, group.latestBillId, group.earliestTranDate);

    let variancePct = null;
    let varianceAmt = null;
    if (prior && prior.mrc !== 0) {
      varianceAmt = currentRate - prior.mrc;
      variancePct = ((currentRate - prior.mrc) / prior.mrc) * 100;
    }

    const status = classify(variancePct);

    const billRefArr = Array.from(group.billRefs);
    const billRefDisplay = billRefArr.length === 1
      ? billRefArr[0]
      : `${billRefArr[0]} +${billRefArr.length - 1}`;
    const vendorArr = Array.from(group.vendors);
    const vendorDisplay = vendorArr.length === 1
      ? vendorArr[0]
      : `Multiple (${vendorArr.length})`;

    results.push({
      status,
      billRef: billRefDisplay,
      billId: billRefDisplay,
      billDate: group.latestDate,
      vendor: vendorDisplay,
      currency: group.currency,
      vocItem: group.itemCode || `Item #${group.itemId}`,
      vocItemId: group.itemId,
      currentRate,
      priorRate: prior ? prior.mrc : null,
      priorBillRef: prior ? `VENDBILL${prior.vocId}` : null,
      priorBillDate: prior ? (typeof prior.vocDate === 'string' ? prior.vocDate.slice(0, 10) : new Date(prior.vocDate).toISOString().slice(0, 10)) : null,
      variancePct,
      varianceAmt,
    });
  }

  return results;
}

module.exports = { classify, analyzeBills };
