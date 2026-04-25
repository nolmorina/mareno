import mongoose, { Schema } from 'mongoose';

/* ── Product ────────────────────────────────────────────────────── */
const ProductSchema = new Schema({
  id:       { type: Number, required: true },
  order:    { type: Number, default: 0 },
  hidden:   { type: Boolean, default: false },
  name:     { type: String, required: true },
  cat:      { type: String, required: true },
  cats:     { type: String, default: '' },
  price:    { type: String, required: true },
  priceOld: { type: String, default: '' },
  badge:    { type: String, default: '' },
  img:      { type: String, default: '' },
  images:   [String],
  colors:   [{ bg: String, title: String }],
  desc:     { type: String, default: '' },
  specs:    [[String]],
  sizes:    [String],
  avail:    [String],
}, { timestamps: true });

/* ── Site Settings (hero + editorial) ──────────────────────────── */
const SettingsSchema = new Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

/* ── Admin User ─────────────────────────────────────────────────── */
const AdminUserSchema = new Schema({
  username:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['admin', 'editor'], default: 'admin' },
  active:       { type: Boolean, default: true },
}, { timestamps: true });

/* ── Activity Log ───────────────────────────────────────────────── */
const LogSchema = new Schema({
  username: { type: String, required: true },
  action:   { type: String, required: true }, // e.g. "save_products", "upload_image"
  detail:   { type: String, default: '' },     // free text for extra context
  ip:       { type: String, default: '' },
}, { timestamps: true });

export const Product    = mongoose.models.Product    ?? mongoose.model('Product',    ProductSchema);
export const Settings   = mongoose.models.Settings   ?? mongoose.model('Settings',   SettingsSchema);
export const AdminUser  = mongoose.models.AdminUser  ?? mongoose.model('AdminUser',  AdminUserSchema);
export const Log        = mongoose.models.Log        ?? mongoose.model('Log',        LogSchema);
