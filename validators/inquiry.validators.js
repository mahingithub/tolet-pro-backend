'use strict';

const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z
  .string()
  .trim()
  .refine((v) => mongoose.Types.ObjectId.isValid(v), 'অবৈধ আইডি।');

// Status enum MUST match `models/Inquiry.js` (the InquirySchema's status
// field). Earlier this exposed UI-only labels ('seen', 'replied', 'closed')
// which the model rejected on save → every PATCH 500'd.
const INQUIRY_STATUS = ['new', 'pending', 'accepted', 'rejected', 'archived', 'converted', 'active'];

module.exports = {
  createInquiry: z.object({
    propertyId: objectIdSchema,
    message:    z.string().trim().min(1, 'বার্তা লিখুন।').max(2000),
    // Optional preferred lease window — the model accepts these and the
    // host UI surfaces them on the inquiry card, but they're not required.
    leaseStart: z.union([z.string().datetime(), z.string().date(), z.null()]).optional(),
    leaseEnd:   z.union([z.string().datetime(), z.string().date(), z.null()]).optional(),
  }),
  updateInquiry: z.object({
    status: z.enum(INQUIRY_STATUS),
  }),
};
