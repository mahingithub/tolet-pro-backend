'use strict';

const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z
  .string()
  .trim()
  .refine((v) => mongoose.Types.ObjectId.isValid(v), 'অবৈধ আইডি।');

module.exports = {
  createVisitSchedule: z.object({
    inquiryId: objectIdSchema,
    scheduledDate: z.string().datetime({ message: 'সঠিক তারিখ দিন।' }).or(z.string()),
    scheduledTime: z.string().min(1, 'সময় দিন।'),
    location: z.string().optional(),
  }),

  requestVisitSchedule: z.object({
    inquiryId: objectIdSchema,
    requestedDate: z.string().datetime({ message: 'সঠিক তারিখ দিন।' }).or(z.string()),
    requestedTime: z.string().min(1, 'সময় দিন।'),
  }),

  approveVisitRequest: z.object({
    location: z.string().optional(),
  }),

  rescheduleVisit: z.object({
    newDate: z.string().datetime({ message: 'সঠিক তারিখ দিন।' }).or(z.string()),
    newTime: z.string().min(1, 'সময় দিন।'),
    newLocation: z.string().optional(),
  }),
};
