'use strict';

/**
 * document.controller.js — landlord Document Vault (real storage).
 * ──────────────────────────────────────────────────────────────────────────
 *   POST   /api/documents       multipart: file + folder + tenant snapshot
 *   GET    /api/documents       ?folder=agreements  → landlord's files
 *   DELETE /api/documents/:id   removes from Cloudinary + DB
 *
 * Every query is scoped to req.user._id so one landlord can never read or
 * delete another's files.
 */

const mongoose   = require('mongoose');
const Document    = require('../models/Document');
const cloudinary  = require('../services/cloudinary.service');
const ApiError    = require('../utils/ApiError');

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

const VALID_FOLDERS = ['agreements', 'nids', 'payments', 'legal'];

// PDFs / Word docs must go to Cloudinary as 'raw'; images as 'image'.
function resourceTypeFor(mime) {
  return String(mime || '').startsWith('image/') ? 'image' : 'raw';
}

// ── POST /api/documents ──────────────────────────────────────────────────────
async function uploadDocument(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'কোনো ফাইল পাওয়া যায়নি।', code: 'no_file' });
    }

    const landlordId   = req.user._id;
    const folder       = VALID_FOLDERS.includes(req.body.folder) ? req.body.folder : 'legal';
    const mime         = req.file.mimetype || '';
    const resourceType = resourceTypeFor(mime);

    // Upload straight from multer's memory buffer. transformation:null → no
    // image processing (required for raw/pdf, harmless for images here).
    const uploaded = await cloudinary.uploadBuffer(req.file.buffer, {
      folder: `tolet-pro/documents/${landlordId}`,
      resourceType,
      transformation: null,
    });

    const doc = await Document.create({
      landlordId,
      tenantId:    isObjectId(req.body.tenantId)  ? req.body.tenantId  : null,
      bookingId:   isObjectId(req.body.bookingId) ? req.body.bookingId : null,
      tenantName:  (req.body.tenantName  || '').trim().slice(0, 100),
      tenantPhone: (req.body.tenantPhone || '').trim().slice(0, 20),
      folder,
      fileName:    (req.body.fileName || req.file.originalname || 'document').slice(0, 200),
      fileUrl:     uploaded.secureUrl,
      publicId:    uploaded.publicId,
      fileType:    mime,
      fileSize:    req.file.size || uploaded.bytes || 0,
    });

    return res.status(201).json({ document: doc });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/documents/direct ────────────────────────────────────────────────
async function saveDirectDocument(req, res, next) {
  try {
    const {
      secureUrl, publicId, fileName, folder, format, bytes,
      // WHO THIS FILE IS ABOUT. Accepted here because this is the path the app
      // actually uploads through — the multipart route below has always stored
      // these, but nothing calls it. Without them every document was saved with
      // bookingId: null, so the landlord could pick a tenant on the upload form
      // and the link was thrown away between the browser and the database.
      tenantId, bookingId, tenantName, tenantPhone,
    } = req.body || {};

    if (!secureUrl || !publicId) {
      throw ApiError.badRequest('secureUrl and publicId are required.');
    }

    // Determine fileType from format
    const isPdf = format === 'pdf';
    const isDoc = ['doc', 'docx'].includes(format);
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(format);
    
    let fileType = 'other';
    if (isPdf) fileType = 'pdf';
    else if (isDoc) fileType = 'doc';
    else if (isImage) fileType = 'image';

    const doc = await Document.create({
      landlordId: req.user._id,
      folder: folder || 'Uncategorized',
      fileName: fileName || 'Uploaded Document',
      fileType,
      fileSize: bytes || 0,
      fileUrl: secureUrl,
      publicId: publicId,
      // Same validation the multipart route uses: ids only when they really are
      // ids, and the name/phone kept as a snapshot so the file still says whose
      // it was after the booking is gone.
      tenantId:    isObjectId(tenantId)  ? tenantId  : null,
      bookingId:   isObjectId(bookingId) ? bookingId : null,
      tenantName:  (tenantName  || '').trim().slice(0, 100),
      tenantPhone: (tenantPhone || '').trim().slice(0, 20),
    });

    res.status(201).json({
      ok: true,
      message: 'Document saved successfully.',
      document: doc,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/documents ───────────────────────────────────────────────────────
async function listDocuments(req, res, next) {
  try {
    const filter = { landlordId: req.user._id };
    if (VALID_FOLDERS.includes(req.query.folder)) filter.folder = req.query.folder;
    const documents = await Document.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ documents });
  } catch (err) {
    return next(err);
  }
}

// ── DELETE /api/documents/:id ────────────────────────────────────────────────
async function deleteDocument(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(404).json({ message: 'ডকুমেন্ট পাওয়া যায়নি।' });

    const doc = await Document.findOne({ _id: id, landlordId: req.user._id });
    if (!doc) return res.status(404).json({ message: 'ডকুমেন্ট পাওয়া যায়নি।' });

    // Best-effort Cloudinary cleanup so we don't leak storage (non-fatal).
    await cloudinary.destroy(doc.publicId, { resourceType: resourceTypeFor(doc.fileType) });

    await doc.deleteOne();
    return res.json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
}

module.exports = { uploadDocument, listDocuments, deleteDocument, saveDirectDocument };