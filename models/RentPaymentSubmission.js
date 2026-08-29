'use strict';

/**
 * RentPaymentSubmission model — a tenant's "I have paid" manual rent claim.
 * ──────────────────────────────────────────────────────────────────────────
 * TO-LET PRO V1 has no payment gateway. After a tenant sends rent to the
 * landlord's personal account (see PaymentMethod), they submit proof here:
 *
 *   Pending Verification  →  Landlord Review  →  Approved / Rejected
 *
 * On APPROVE the landlord's booking ledger is written + a Receipt generated
 * (via bookingPayment.service.applyPayment) and the tenant is notified.
 * On REJECT the tenant is notified with a reason and can re-submit.
 *
 * The doc denormalizes tenant/property snapshots so the landlord's
 * "Pending Rent Payments" list renders without extra JOINs.
 */

const mongoose = require('mongoose');

const RentPaymentSubmissionSchema = new mongoose.Schema(
  {
    bookingId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Booking',  required: true, index: true },
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true, index: true },
    tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',     default: null,  index: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null },

    // WHICH OCCUPANT PAID. null = a classic single-tenant lease (the whole
    // unit). On a shared unit this is the members[] row, and it is what makes
    // the approval write to the right ledger and quote the right amount.
    // Without it a hostel seat's ৳6,000 was approved against the flat's
    // ৳45,600 obligation — the tenant got a receipt for the whole building.
    memberId:   { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    memberName: { type: String, trim: true, default: '', maxlength: 120 },

    // Which month this payment settles — 'YYYY-MM' (matches the ledger key).
    monthKey:   { type: String, required: true, trim: true },
    monthLabel: { type: String, trim: true, default: '' },

    // Denormalized display snapshot for the landlord's pending list.
    tenantName:    { type: String, trim: true, default: '', maxlength: 120 },
    tenantPhone:   { type: String, trim: true, default: '', maxlength: 20 },
    propertyTitle: { type: String, trim: true, default: '', maxlength: 200 },
    // WHERE the payer lives — a building name is not an address when the
    // landlord is looking at twelve claims from twelve rooms of it.
    floorNumber:   { type: String, trim: true, default: '', maxlength: 40 },
    roomNumber:    { type: String, trim: true, default: '', maxlength: 40 },
    seatLabel:     { type: String, trim: true, default: '', maxlength: 40 },

    // What the tenant claims they paid.
    amount:      { type: Number, required: true, min: 0 },
    txnId:       { type: String, trim: true, default: '', maxlength: 80 },
    paymentDate: { type: String, trim: true, default: '' },   // 'YYYY-MM-DD' as entered

    // Which of the landlord's methods the tenant says they paid to.
    paymentMethodType:  { type: String, trim: true, default: '' },  // bkash|nagad|rocket|bank
    paymentMethodLabel: { type: String, trim: true, default: '' },  // e.g. 'bKash'

    // Optional payment screenshot (Cloudinary).
    screenshotUrl:      { type: String, trim: true, default: '' },
    screenshotPublicId: { type: String, trim: true, default: '' },

    notes: { type: String, trim: true, default: '', maxlength: 500 },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    // Set when the landlord acts on the submission.
    reviewedAt:      { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true },
);

RentPaymentSubmissionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

// Landlord "Pending Rent Payments" list = filter by landlordId + status.
RentPaymentSubmissionSchema.index({ landlordId: 1, status: 1, createdAt: -1 });
// Tenant view + per-month lookups.
RentPaymentSubmissionSchema.index({ tenantId: 1, createdAt: -1 });
RentPaymentSubmissionSchema.index({ bookingId: 1, monthKey: 1 });
// The duplicate-pending guard is PER OCCUPANT: four hostel seats filing for
// the same month are four claims, not one tenant submitting four times.
RentPaymentSubmissionSchema.index({ bookingId: 1, memberId: 1, monthKey: 1, status: 1 });

module.exports = mongoose.model('RentPaymentSubmission', RentPaymentSubmissionSchema);
