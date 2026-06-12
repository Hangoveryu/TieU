// autoclean.js — 过期数据自动清理
// 应用启动时执行一次，然后每天检查一次

const store = require('./store');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 小时
let timer = null;

/** 执行一次清理 */
function run() {
  try {
    const days = parseInt(store.getSetting('retention_days'), 10) || 5;
    const result = store.cleanExpired(days);
    if (result.deleted > 0) {
      console.log(`[autoclean] 清理了 ${result.deleted} 条过期记录`);
    }
  } catch (e) {
    console.error('[autoclean] 清理失败:', e.message);
  }
}

/** 启动定时清理 */
function start() {
  run(); // 立即执行一次
  timer = setInterval(run, CHECK_INTERVAL_MS);
}

/** 停止定时清理 */
function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, run };
