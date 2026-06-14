'use strict';

const mongoose = require('mongoose');

const VisitScheduleSchema = new mongoose.Schema(
  {
    inquiryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inquiry', required: true, index: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    
    scheduledDate: { type: Date },
    scheduledTime: { type: String },
    location: { type: String, trim: true, default: '' },
    
    scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'rescheduled'],
      default: 'pending',
      index: true,
    },
    
    tenantRequest: {
      requestedDate: { type: Date },
      requestedTime: { type: String },
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    },
    
    rescheduleHistory: [
      {
        previousDate: Date,
        previousTime: String,
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true }
);

VisitScheduleSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('VisitSchedule', VisitScheduleSchema);
