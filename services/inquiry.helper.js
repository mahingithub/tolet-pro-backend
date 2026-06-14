'use strict';

const Inquiry = require('../models/Inquiry');

/**
 * Helper to update inquiry status and push to statusHistory.
 * @param {string} inquiryId
 * @param {string} newStatus
 * @param {string} changedByUserId
 * @returns {Promise<object>} updated inquiry document
 */
async function updateInquiryStatus(inquiryId, newStatus, changedByUserId) {
  const inquiry = await Inquiry.findById(inquiryId);
  if (!inquiry) throw new Error('Inquiry not found');

  inquiry.status = newStatus;
  
  if (changedByUserId) {
    inquiry.statusHistory.push({
      status: newStatus,
      changedAt: new Date(),
      changedBy: changedByUserId,
    });
  } else {
    inquiry.statusHistory.push({
      status: newStatus,
      changedAt: new Date(),
    });
  }

  await inquiry.save();
  return inquiry;
}

module.exports = {
  updateInquiryStatus,
};
