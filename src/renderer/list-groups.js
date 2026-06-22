function isPinned(clip) {
  return clip && Number(clip.pinned) === 1;
}

function byNewestFirst(a, b) {
  return Number(b.created_at || 0) - Number(a.created_at || 0);
}

function byRenderOrder(a, b) {
  const pinDifference = Number(isPinned(b)) - Number(isPinned(a));
  return pinDifference || byNewestFirst(a, b);
}

function upsertClipById(clips, updatedClip) {
  const items = Array.isArray(clips) ? clips : [];
  return items
    .filter(clip => clip.id !== updatedClip.id)
    .concat(updatedClip)
    .sort(byRenderOrder);
}

function groupClipsForRender(clips, todayStart) {
  const items = Array.isArray(clips) ? clips.slice() : [];
  const start = Number(todayStart);

  const pinnedClips = items.filter(isPinned).sort(byNewestFirst);
  const normalClips = items.filter(clip => !isPinned(clip)).sort(byNewestFirst);
  const todayClips = normalClips.filter(clip => Number(clip.created_at) >= start);
  const olderClips = normalClips.filter(clip => Number(clip.created_at) < start);
  const groups = [];

  if (pinnedClips.length > 0) {
    groups.push({ key: 'pinned', title: '置顶记录', clips: pinnedClips });
  }
  if (todayClips.length > 0) {
    groups.push({ key: 'today', title: '今天', clips: todayClips });
  }
  if (olderClips.length > 0) {
    groups.push({ key: 'older', title: '更早的记录', clips: olderClips });
  }

  return groups;
}

function shouldShowGroupDivider(group) {
  return Boolean(group && group.title);
}

if (typeof window !== 'undefined') {
  window.groupClipsForRender = groupClipsForRender;
  window.shouldShowGroupDivider = shouldShowGroupDivider;
  window.upsertClipById = upsertClipById;
}

if (typeof module !== 'undefined') {
  module.exports = {
    groupClipsForRender,
    shouldShowGroupDivider,
    upsertClipById
  };
}
