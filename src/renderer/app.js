// app.js — 渲染进程主逻辑
// 负责列表渲染、搜索、设置和 IPC 通信

// ============================================================
// 状态
// ============================================================
let clips = [];
let settings = {};
let searchKeyword = '';

// ============================================================
// DOM 元素
// ============================================================
const cardList = document.getElementById('cardList');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('search');
const themeSelect = document.getElementById('themeSelect');
const statsEl = document.getElementById('stats');
const toastEl = document.getElementById('toast');

// ============================================================
// 时间格式化
// ============================================================
function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================
// Toast 提示
// ============================================================
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.style.display = '';
  toastEl.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

// ============================================================
// 渲染卡片列表
// ============================================================
function render() {
  cardList.innerHTML = '';

  // 确保固定复选框存在且可见
  var pinCheck = document.getElementById('pinPanelCheck');
  if (pinCheck) pinCheck.style.display = '';

  if (clips.length === 0) {
    emptyState.style.display = 'block';
    statsEl.textContent = '共 0 条';
    return;
  }

  emptyState.style.display = 'none';
  statsEl.textContent = '共 ' + clips.length + ' 条';

  // 按置顶/今天/更早分组。置顶记录不参与时间分组，始终在最上方。
  var now = new Date();
  var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var groups = window.groupClipsForRender(clips, todayStart);

  function makeCard(clip) {
    const card = document.createElement('div');
    card.className = clip.pinned ? 'card pinned' : 'card';
    card.dataset.id = clip.id;
    card.addEventListener('click', (e) => {
      // 如果点击的是按钮则不触发复制
      if (e.target.closest('button')) return;
      copyClip(clip);
    });

    // 内容区域
    const content = document.createElement('div');
    content.className = 'card-content';

    if (clip.type === 'text') {
      content.textContent = clip.content;
    } else if (clip.type === 'image') {
      const img = document.createElement('img');
      img.src = 'file://' + (clip.thumb_path || clip.image_path);
      img.alt = '剪贴板图片';
      img.style.cssText = 'max-width:100%; max-height:120px; border-radius:4px; object-fit:cover;';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        showFullImage(clip);
      });
      content.appendChild(img);
    }

    card.appendChild(content);

    // 底部信息栏
    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const time = document.createElement('span');
    time.textContent = formatTime(clip.created_at);
    meta.appendChild(time);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    // 置顶按钮
    const pinBtn = document.createElement('button');
    pinBtn.className = 'btn-pin';
    pinBtn.textContent = clip.pinned ? '★' : '☆';
    pinBtn.title = clip.pinned ? '取消置顶' : '置顶';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(clip.id);
    });
    actions.appendChild(pinBtn);

    // 删除按钮
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.textContent = '🗑';
    delBtn.title = '删除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteClip(clip.id);
    });
    actions.appendChild(delBtn);

    meta.appendChild(actions);
    card.appendChild(meta);

    // 置顶标记
    if (clip.pinned) {
      var badge = document.createElement('span');
      badge.className = 'pin-badge';
      badge.textContent = '📌';
      badge.title = '已置顶';
      card.appendChild(badge);
    }

    return card;
  }

  groups.forEach(function (group) {
    if (window.shouldShowGroupDivider(group)) {
      var divider = document.createElement('div');
      divider.className = 'time-divider';
      divider.textContent = '── ' + group.title + ' ──';
      cardList.appendChild(divider);
    }

    group.clips.forEach(function (clip) {
      cardList.appendChild(makeCard(clip));
    });
  });
}

// ============================================================
// 操作
// ============================================================

async function copyClip(clip) {
  const result = await window.electronAPI.copyClip(clip.id);
  showToast(result && result.pasted ? '已粘贴 ✓' : '已复制到剪贴板 ✓');
}

function showFullImage(clip) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:200;display:flex;align-items:center;justify-content:center;';
  overlay.addEventListener('click', () => overlay.remove());

  const img = document.createElement('img');
  img.src = 'file://' + (clip.image_path || clip.thumb_path);
  img.style.cssText = 'max-width:95%;max-height:95%;object-fit:contain;border-radius:4px;';
  overlay.appendChild(img);

  document.body.appendChild(overlay);
}

async function togglePin(id) {
  const result = await window.electronAPI.togglePin(id);
  if (result) {
    showToast(result.pinned ? '已置顶 📌' : '已取消置顶');
    await loadClips();
  }
}

async function deleteClip(id) {
  await window.electronAPI.deleteClip(id);
  showToast('已删除 🗑');
  await loadClips();
}

// ============================================================
// 数据加载
// ============================================================

async function loadClips() {
  if (searchKeyword) {
    clips = await window.electronAPI.searchClips(searchKeyword, 200);
  } else {
    clips = await window.electronAPI.getClips(200, 0);
  }
  render();
}

async function loadSettings() {
  settings = await window.electronAPI.getSettings();
  retentionSelect.value = settings.retention_days || '5';
  themeSelect.value = settings.theme || 'light';
  applyTheme(themeSelect.value);

  // 开机自启状态
  const auto = await window.electronAPI.getAutoStart();
  const autoCheckbox = document.getElementById('autostartCheck');
  if (autoCheckbox) {
    autoCheckbox.checked = auto.enabled;
  }
}

function applyTheme(mode) {
  const body = document.getElementById('body');
  body.classList.remove('light', 'dark');
  if (mode === 'dark') {
    body.classList.add('dark');
  } else if (mode === 'light') {
    body.classList.add('light');
  } else {
    // system: 检测系统偏好
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      body.classList.add('dark');
    } else {
      body.classList.add('light');
    }
  }
}

// ============================================================
// 事件绑定
// ============================================================

// 搜索
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchKeyword = searchInput.value.trim();
    loadClips();
  }, 200); // 200ms 防抖
});

// 保留天数
retentionSelect.addEventListener('change', async () => {
  await window.electronAPI.setSetting('retention_days', retentionSelect.value);
  showToast('保留天数已设为 ' + retentionSelect.value + ' 天');
});

// 主题
themeSelect.addEventListener('change', async () => {
  const val = themeSelect.value;
  await window.electronAPI.setSetting('theme', val);
  applyTheme(val);
  showToast('主题: ' + themeSelect.options[themeSelect.selectedIndex].text);
});

// 开机自启
document.getElementById('autostartCheck').addEventListener('change', async (e) => {
  const result = await window.electronAPI.toggleAutoStart();
  showToast(result.enabled ? '已开启开机自启' : '已关闭开机自启');
  e.target.checked = result.enabled;
});

// 监听系统主题变化
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeSelect.value === 'system') applyTheme('system');
  });
}

// 监听新记录（主进程推送）
window.electronAPI.onNewClip((clip) => {
  // 新记录插入到列表（仅在无搜索关键词时）
  if (!searchKeyword) {
    clips.unshift(clip);
    render();
  }
});

// 面板显示时刷新数据，同步固定按钮状态
window.electronAPI.onPanelShown(async (data) => {
  searchInput.value = '';
  searchKeyword = '';
  searchInput.focus();
  await loadClips();
  // 同步固定按钮：主进程的 panelPinned 状态
  const pinCheck = document.getElementById('pinPanelCheck');
  if (pinCheck) pinCheck.checked = Boolean(data.pinned);
});

// ============================================================
// 键盘快捷键（渲染进程内）
// ============================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.electronAPI.hidePanel();
  }
});

// 固定面板复选框
document.getElementById('pinPanelCheck').addEventListener('change', async (e) => {
  e.stopPropagation();
  var checked = e.target.checked;
  var result = await window.electronAPI.togglePanelPin();
  e.target.checked = result.pinned; // 始终以主进程返回的状态为准
    showToast(result.pinned ? '面板已固定' : '面板已取消固定');
});

// ============================================================
// 初始化
// ============================================================

async function init() {
  await loadSettings();
  await loadClips();
}

init();
