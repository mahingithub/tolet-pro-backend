'use strict';

/**
 * Call.js — WebRTC call state model.
 *
 * Tracks the lifecycle of a 1-to-1 voice or video call:
 *   ringing → accepted → ended
 *   ringing → rejected
 *   ringing → missed   (30s timeout with no answer)
 *
 * The `roomId` is a unique identifier used by the media provider
 * (ZegoCloud / Agora / Twilio) to create the actual media room.
 * It is generated server-side when the call is initiated.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const CallSchema = new mongoose.Schema(
  {
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['voice', 'video'],
      required: true,
    },
    status: {
      type: String,
      enum: ['ringing', 'accepted', 'rejected', 'missed', 'ended'],
      default: 'ringing',
      index: true,
    },
    roomId: {
      type: String,
      default: () => `room_${crypto.randomBytes(12).toString('hex')}`,
      unique: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number,
      default: 0,
    },
    // Phase Call-4: users who have "seen" this call in their Calls tab.
    // The missed-call badge counts incoming missed calls where the current
    // user's id is NOT in this array. POST /api/calls/mark-seen adds them.
    seenBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // Phase Call-4: per-user soft delete. DELETE /api/calls/:id adds the
    // requester here; getCallHistory hides calls where the current user is
    // listed, so deleting only removes it from THAT user's history.
    deletedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true }
);

// Auto-compute duration when the call ends.
CallSchema.pre('save', function (next) {
  if (this.isModified('endedAt') && this.endedAt && this.startedAt) {
    this.duration = Math.round((this.endedAt - this.startedAt) / 1000);
  }
  next();
});

// Map _id to id in JSON output.
CallSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Call', CallSchema);
