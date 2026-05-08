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

/* ── Inventory ──────────────────────────────────────────────────── */
const StockLineSchema = new Schema({
  size: { type: String, required: true },
  qty:  { type: Number, default: 0, min: 0 },
}, { _id: false });

const InventorySchema = new Schema({
  productId:   { type: Number, required: true, unique: true },
  productName: { type: String, default: '' },
  stock:       [StockLineSchema],
  lowStockAt:  { type: Number, default: 2 },
}, { timestamps: true });

/* ── Stock Log (append-only audit trail) ────────────────────────── */
const StockLogSchema = new Schema({
  productId:   { type: Number, required: true },
  productName: { type: String, default: '' },
  size:        { type: String, required: true },
  delta:       { type: Number, required: true },
  reason:      { type: String, enum: ['sale', 'restock', 'correction', 'return', 'damage'], default: 'correction' },
  note:        { type: String, default: '', maxlength: 300 },
  adminUser:   { type: String, default: '' },
  qtyBefore:   { type: Number, default: 0 },
  qtyAfter:    { type: Number, default: 0 },
}, { timestamps: true });

export const Product    = mongoose.models.Product    ?? mongoose.model('Product',    ProductSchema);
export const Settings   = mongoose.models.Settings   ?? mongoose.model('Settings',   SettingsSchema);
export const AdminUser  = mongoose.models.AdminUser  ?? mongoose.model('AdminUser',  AdminUserSchema);
export const Log        = mongoose.models.Log        ?? mongoose.model('Log',        LogSchema);
export const Inventory  = mongoose.models.Inventory  ?? mongoose.model('Inventory',  InventorySchema);
export const StockLog   = mongoose.models.StockLog   ?? mongoose.model('StockLog',   StockLogSchema);
