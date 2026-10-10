// Nạp mọi thư viện khối (đăng ký vào registry khi import).
// Thêm thư viện mới: tạo file trong thư mục này và import ở đây.
import './core.js';
import './chart.js';
import './automotive.js';
import './internal.js';

export { defineBlock, getBlockDef, listBlockTypes } from './registry.js';
