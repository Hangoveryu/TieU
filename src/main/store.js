// store.js — SQLite 数据库操作封装（基于 sql.js）
// sql.js 是纯 JavaScript 实现，数据库完全在内存中，需要手动 save() 写回磁盘

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

// 模块级状态
let db = null;
let dbPath = null;

// ============================================================
// 数据库初始化
// ============================================================

async function init(dataPath, wasmDir) {
  dbPath = path.join(dataPath, 'clipboard.db');

  // 确保图片存储目录存在
  const imagesDir = path.join(dataPath, 'images', 'originals');
  const thumbsDir = path.join(dataPath, 'images', 'thumbs');
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });

  // 指定 wasm 文件路径（sql.js 需要 locateFile 来找到 .wasm）
  const sqlConfig = {};
  if (wasmDir) {
    sqlConfig.locateFile = function (file) { return path.join(wasmDir, file); };
  }
  const SQL = await initSqlJs(sqlConfig);

  // 尝试加载已有数据库，失败则创建新库
  try {
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  } catch (e) {
    console.error('加载数据库失败，创建新库:', e.message);
    db = new SQL.Database();
  }

  // 建表（IF NOT EXISTS 保证幂等）
  db.run(`
    CREATE TABLE IF NOT EXISTS clips (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT    NOT NULL,   -- 'text' | 'image'
      content      TEXT,               -- 文字内容（图像类型为空）
      image_path   TEXT,               -- 原图路径
      thumb_path   TEXT,               -- 缩略图路径
      content_hash TEXT,               -- 内容哈希（用于去重）
      created_at   INTEGER NOT NULL,   -- 复制时间戳（毫秒）
      pinned       INTEGER DEFAULT 0   -- 0=普通 1=置顶
    )
  `);

  // 为搜索和排序创建索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_clips_pinned ON clips(pinned)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_clips_type ON clips(type)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 写入默认设置（仅当设置不存在时）
  const defaults = {
    retention_days: '5',
    shortcut: 'Ctrl+Shift+Z',
    autostart: 'false'
  };
  for (const [key, value] of Object.entries(defaults)) {
    const result = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
    if (!result.length || !result[0].values.length) {
      db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  save();
  return db;
}

// ============================================================
// 持久化
// ============================================================

function save() {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    console.error('数据库写盘失败:', e.message);
  }
}

// ============================================================
// 工具函数
// ============================================================

// 计算内容哈希（用于去重）
function hashContent(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// 将 sql.js 行数组转为对象数组
function rowsToObjects(result) {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

// ============================================================
// 剪贴板记录 CRUD
// ============================================================

/** 新增文字记录 */
function addText(content) {
  const hash = hashContent(content);

  // 去重：检查所有记录是否有相同哈希
  const dup = db.exec(
    'SELECT COUNT(*) as cnt FROM clips WHERE content_hash = ?',
    [hash]
  );
  if (dup.length && dup[0].values.length && dup[0].values[0][0] > 0) {
    return null; // 重复内容，跳过
  }

  const now = Date.now();
  db.run(
    'INSERT INTO clips (type, content, content_hash, created_at) VALUES (?, ?, ?, ?)',
    ['text', content, hash, now]
  );
  // 重要：先获取 last_insert_rowid() 再 save()，因为 sql.js 的 export() 会重置 rowid
  const newId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  save();

  return {
    id: newId,
    type: 'text',
    content,
    content_hash: hash,
    created_at: now,
    pinned: 0
  };
}

/** 新增图片记录 */
function addImage(imagePath, thumbPath) {
  // 读取图片文件计算哈希
  let hash;
  try {
    const buffer = fs.readFileSync(imagePath);
    hash = crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (e) {
    hash = Date.now().toString(); // 读取失败用时间戳兜底
  }

  // 去重：检查所有记录是否有相同哈希
  const dup = db.exec(
    'SELECT COUNT(*) as cnt FROM clips WHERE content_hash = ?',
    [hash]
  );
  if (dup.length && dup[0].values.length && dup[0].values[0][0] > 0) {
    return null;
  }

  const now = Date.now();
  db.run(
    'INSERT INTO clips (type, image_path, thumb_path, content_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    ['image', imagePath, thumbPath, hash, now]
  );
  // 重要：在 save() 前获取 last_insert_rowid()，因为 sql.js 的 export() 会重置它
  const newId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  save();

  return {
    id: newId,
    type: 'image',
    image_path: imagePath,
    thumb_path: thumbPath,
    content_hash: hash,
    created_at: now,
    pinned: 0
  };
}

/** 获取所有记录（置顶优先，时间降序） */
function getAll(limit = 100, offset = 0) {
  const result = db.exec(
    `SELECT id, type, content, image_path, thumb_path, created_at, pinned
     FROM clips
     ORDER BY pinned DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rowsToObjects(result);
}

/** 搜索记录（关键词模糊匹配，不区分大小写） */
function search(keyword, limit = 100) {
  const pattern = `%${keyword}%`;
  const result = db.exec(
    `SELECT id, type, content, image_path, thumb_path, created_at, pinned
     FROM clips
     WHERE type = 'text' AND content LIKE ?
     ORDER BY pinned DESC, created_at DESC
     LIMIT ?`,
    [pattern, limit]
  );
  return rowsToObjects(result);
}

/** 切换置顶状态 */
function togglePin(id) {
  db.run('UPDATE clips SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?', [id]);
  save();
  const result = db.exec('SELECT id, pinned FROM clips WHERE id = ?', [id]);
  if (result.length && result[0].values.length) {
    return { id, pinned: result[0].values[0][1] };
  }
  return null;
}

/** 删除记录（同时删除关联的图片文件） */
function deleteById(id) {
  // 先查出要删的记录（获取图片路径）
  const record = db.exec('SELECT type, image_path, thumb_path FROM clips WHERE id = ?', [id]);
  if (record.length && record[0].values.length) {
    const [type, imagePath, thumbPath] = record[0].values[0];
    if (type === 'image') {
      // 删除关联的图片文件（忽略文件不存在的错误）
      try { if (imagePath) fs.unlinkSync(imagePath); } catch (e) { /* 忽略 */ }
      try { if (thumbPath) fs.unlinkSync(thumbPath); } catch (e) { /* 忽略 */ }
    }
  }

  db.run('DELETE FROM clips WHERE id = ?', [id]);
  save();
  return { deleted: true, id };
}

/** 获取记录总数 */
function count() {
  const result = db.exec('SELECT COUNT(*) as total FROM clips');
  if (result.length && result[0].values.length) {
    return result[0].values[0][0];
  }
  return 0;
}

// ============================================================
// 设置
// ============================================================

/** 读取单个设置 */
function getSetting(key) {
  const result = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
  if (result.length && result[0].values.length) {
    return result[0].values[0][0];
  }
  return null;
}

/** 写入设置 */
function setSetting(key, value) {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  save();
}

/** 读取所有设置（返回键值对象） */
function getAllSettings() {
  const result = db.exec('SELECT key, value FROM settings');
  if (!result.length) return {};
  const settings = {};
  result[0].values.forEach(row => {
    settings[row[0]] = row[1];
  });
  return settings;
}

// ============================================================
// 过期清理
// ============================================================

/** 删除超过保留天数的非置顶记录 */
function cleanExpired(retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  // 先查出要删除的图片记录（以便删除文件）
  const expiredImages = db.exec(
    `SELECT image_path, thumb_path FROM clips
     WHERE pinned = 0 AND type = 'image' AND created_at < ?`,
    [cutoff]
  );
  if (expiredImages.length) {
    expiredImages[0].values.forEach(row => {
      try { if (row[0]) fs.unlinkSync(row[0]); } catch (e) { /* 忽略 */ }
      try { if (row[1]) fs.unlinkSync(row[1]); } catch (e) { /* 忽略 */ }
    });
  }

  // 删除数据库记录
  db.run('DELETE FROM clips WHERE pinned = 0 AND created_at < ?', [cutoff]);
  const deleted = db.exec('SELECT changes()')[0].values[0][0];
  save();

  return { deleted };
}

/** 获取过期记录数（不实际删除） */
function countExpired(retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.exec(
    'SELECT COUNT(*) FROM clips WHERE pinned = 0 AND created_at < ?',
    [cutoff]
  );
  if (result.length && result[0].values.length) {
    return result[0].values[0][0];
  }
  return 0;
}

// ============================================================
// 关闭数据库
// ============================================================

function close() {
  save();
  if (db) {
    db.close();
    db = null;
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  init,
  save,
  close,

  // CRUD
  addText,
  addImage,
  getAll,
  search,
  togglePin,
  deleteById,
  count,

  // 设置
  getSetting,
  setSetting,
  getAllSettings,

  // 清理
  cleanExpired,
  countExpired,

  // 工具
  hashContent
};
