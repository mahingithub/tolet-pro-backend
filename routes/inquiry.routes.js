'use strict';

const express = require('express');
const ctl = require('../controllers/inquiry.controller');
const v = require('../validators/inquiry.validators');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Tenant sends an inquiry to a host. Auth required so we can attach the
// tenant's identity to the inquiry record. A repeat inquiry on the same
// property APPENDS to the existing thread (see inquiry.service.createInquiry).
router.post('/', requireAuth, validate(v.createInquiry), ctl.createInquiry);

// Tenant lists inquiries they've sent — useful for an "Inquiries" tab.
router.get('/mine', requireAuth, ctl.getMyInquiries);

// Host actions on inquiries
router.post('/:id/accept', requireAuth, ctl.acceptInquiry);
router.post('/:id/reject', requireAuth, ctl.rejectInquiry);

// Thread reply — landlord "Reply" button OR tenant follow-up. Body: { text }.
router.post('/:id/reply', requireAuth, ctl.replyInquiry);

// Two-way visit scheduling.
//   POST  /:id/visit   → propose a slot   Body: { date, time, location? }
//   PATCH /:id/visit   → accept/reject    Body: { action: 'accept' | 'reject' }
router.post('/:id/visit', requireAuth, ctl.proposeVisit);
router.patch('/:id/visit', requireAuth, ctl.respondVisit);

// Generic status patch (host-only) — kept for the existing status flow.
router.patch('/:id/status', requireAuth, validate(v.updateInquiry), ctl.updateInquiryStatus);

// NOTE: the old `POST /:id/deal` route was REMOVED. Its controller
// (confirmDeal) created an invalid Booking (status 'confirmed' is not in the
// Booking enum, and it omitted the required leaseStart/leaseEnd/monthlyRent),
// so it threw on every call. Deal confirmation now goes through the booking
// modal → POST /api/bookings (booking.controller.createBooking), which marks
// the inquiry 'final_booking' and emits the realtime "Deal Confirmed" event.

// Either party deletes/withdraws the inquiry
router.delete('/:id', requireAuth, ctl.deleteInquiry);

module.exports = router;