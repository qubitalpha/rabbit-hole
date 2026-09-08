/**
 * rabbit-hole - Popup Controller
 */

// DOM Elements
const scheduleForm = document.getElementById('scheduleForm');
const queryInput = document.getElementById('queryInput');
const statusBanner = document.getElementById('statusBanner');

// Date/Time controls
const dtDisplayText = document.getElementById('dtDisplayText');
const dtRelativeText = document.getElementById('dtRelativeText');
const btnDateToday = document.getElementById('btnDateToday');
const btnDateWeekend = document.getElementById('btnDateWeekend');
const btnDatePlus1 = document.getElementById('btnDatePlus1');
const btnTimeMinus15 = document.getElementById('btnTimeMinus15');
const btnTimePlus15 = document.getElementById('btnTimePlus15');
const btnTimePlus60 = document.getElementById('btnTimePlus60');

// Tabs & Badges
const tabBtnScheduled = document.getElementById('tabBtnScheduled');
const tabBtnHistory = document.getElementById('tabBtnHistory');
const scheduledSection = document.getElementById('scheduledSection');
const historySection = document.getElementById('historySection');
const scheduledTaskList = document.getElementById('scheduledTaskList');
const historyTaskList = document.getElementById('historyTaskList');
const historyToolbar = document.getElementById('historyToolbar');
const selectAllHistory = document.getElementById('selectAllHistory');
const clearAllHistory = document.getElementById('clearAllHistory');
const scheduledCountBadge = document.getElementById('scheduledCountBadge');
const historyCountBadge = document.getElementById('historyCountBadge');

let bannerTimeoutId = null;
let selectedTimestamp = Date.now() + 15 * 60 * 1000;
let activeTab = 'scheduled'; // 'scheduled' | 'history'
const selectedHistoryIds = new Set();

function updateHistoryBulkControls(items) {
  const completedItems = items.filter(item => !item.scheduledTaskId);
  const completedIds = new Set(completedItems.map(item => item.id));
  [...selectedHistoryIds].forEach(id => {
    if (!completedIds.has(id)) selectedHistoryIds.delete(id);
  });
  selectAllHistory.checked = completedItems.length > 0 && selectedHistoryIds.size === completedItems.length;
  selectAllHistory.indeterminate = selectedHistoryIds.size > 0 && !selectAllHistory.checked;
  selectAllHistory.disabled = completedItems.length === 0;
  clearAllHistory.disabled = selectedHistoryIds.size === 0;
}

/**
 * Format timestamp into display date & time
 */
function formatDisplayDateTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  if (isToday) {
    return `Today, ${timeStr}`;
  } else if (isTomorrow) {
    return `Tomorrow, ${timeStr}`;
  } else {
    const monthDay = date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    return `${monthDay}, ${timeStr}`;
  }
}

/**
 * Human-readable relative time string
 */
function formatRelativeTime(timestamp) {
  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) return 'now';

  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 60) {
    return `in ${diffMinutes}m`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  const remMinutes = diffMinutes % 60;
  if (diffHours < 24) {
    return remMinutes > 0 ? `in ${diffHours}h ${remMinutes}m` : `in ${diffHours}h`;
  }
  const diffDays = Math.floor(diffHours / 24);
  const remHours = diffHours % 24;
  return remHours > 0 ? `in ${diffDays}d ${remHours}h` : `in ${diffDays}d`;
}

/**
 * Check if query or task targets YouTube
 */
function isYoutubeQuery(query, taskEngine) {
  if (typeof query !== 'string') return taskEngine === 'youtube';
  const trimmed = query.trim();
  if (/^(?:yt|youtube)(?::|\s+)/i.test(trimmed)) return true;
  if (/^(?:yt|youtube)$/i.test(trimmed)) return true;
  if (/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(trimmed)) return true;
  return taskEngine === 'youtube';
}

/**
 * Clean engine prefix from query text for UI display
 */
function cleanQueryText(query) {
  if (typeof query !== 'string') return '';
  return query.trim().replace(/^(?:youtube|yt|google|g)(?::|\s*)/i, '').trim();
}

/**
 * Return the earliest valid scheduled timestamp:
 * Must be at least 60 seconds in the future AND aligned to the exact minute boundary (:00.000).
 */
function getEarliestValidTime() {
  const minTime = Date.now() + 60000;
  const target = new Date(minTime);
  target.setSeconds(0, 0);
  if (target.getTime() < minTime) {
    target.setMinutes(target.getMinutes() + 1);
  }
  return target.getTime();
}

/**
 * Align a timestamp to exact minute boundary (:00.000)
 * ensuring it is never earlier than getEarliestValidTime().
 */
function normalizeScheduledTimestamp(timestamp) {
  const earliest = getEarliestValidTime();
  const target = new Date(timestamp);
  target.setSeconds(0, 0);
  if (target.getTime() < earliest) {
    return earliest;
  }
  return target.getTime();
}

/**
 * Return default scheduled timestamp (15 minutes from now, aligned to minute).
 */
function getDefaultScheduleTime() {
  const earliest = getEarliestValidTime();
  const defaultTarget = new Date(Date.now() + 15 * 60000);
  defaultTarget.setSeconds(0, 0);
  return Math.max(earliest, defaultTarget.getTime());
}

/**
 * Update the Target Date & Time display elements
 */
function updateDateTimeDisplay() {
  selectedTimestamp = normalizeScheduledTimestamp(selectedTimestamp);
  dtDisplayText.textContent = formatDisplayDateTime(selectedTimestamp);
  dtRelativeText.textContent = formatRelativeTime(selectedTimestamp);
}

/**
 * Initialize target date & time based on saved user preference
 */
async function initializeScheduleTime() {
  const lastTime = await StorageService.getLastScheduledTime();
  const earliest = getEarliestValidTime();
  if (lastTime && lastTime >= earliest) {
    selectedTimestamp = normalizeScheduledTimestamp(lastTime);
  } else {
    selectedTimestamp = getDefaultScheduleTime();
  }
  updateDateTimeDisplay();
}

/**
 * Show notification status banner
 */
function showStatus(message, type = 'success') {
  if (bannerTimeoutId) {
    clearTimeout(bannerTimeoutId);
  }

  statusBanner.textContent = message;
  statusBanner.className = `status-banner ${type}`;

  bannerTimeoutId = setTimeout(() => {
    statusBanner.className = 'status-banner hidden';
    statusBanner.textContent = '';
    bannerTimeoutId = null;
  }, 3500);
}

/**
 * Date/Time Button Handlers
 */
btnDateToday.addEventListener('click', () => {
  const current = new Date(selectedTimestamp);
  const target = new Date();
  target.setHours(current.getHours(), current.getMinutes(), 0, 0);

  const earliest = getEarliestValidTime();
  if (target.getTime() < earliest) {
    selectedTimestamp = getDefaultScheduleTime();
  } else {
    selectedTimestamp = target.getTime();
  }
  updateDateTimeDisplay();
});

btnDateWeekend.addEventListener('click', () => {
  const now = new Date();
  const current = new Date(selectedTimestamp);
  const dayOfWeek = now.getDay(); // 0 is Sunday, 6 is Saturday
  let daysUntilSaturday = (6 - dayOfWeek + 7) % 7;

  const target = new Date();
  if (daysUntilSaturday === 0) {
    // Today is Saturday
    target.setHours(current.getHours(), current.getMinutes(), 0, 0);
    const earliest = getEarliestValidTime();
    if (target.getTime() < earliest) {
      // If already past today's time on Saturday, target next Saturday morning 9am
      target.setDate(target.getDate() + 7);
      target.setHours(9, 0, 0, 0);
    }
  } else {
    target.setDate(now.getDate() + daysUntilSaturday);
    target.setHours(current.getHours() || 9, current.getMinutes() || 0, 0, 0);
  }

  selectedTimestamp = normalizeScheduledTimestamp(target.getTime());
  updateDateTimeDisplay();
});

btnDatePlus1.addEventListener('click', () => {
  const target = new Date(selectedTimestamp);
  target.setDate(target.getDate() + 1);
  target.setSeconds(0, 0);
  selectedTimestamp = normalizeScheduledTimestamp(target.getTime());
  updateDateTimeDisplay();
});

btnTimePlus15.addEventListener('click', () => {
  selectedTimestamp = normalizeScheduledTimestamp(selectedTimestamp + 15 * 60000);
  updateDateTimeDisplay();
});

btnTimeMinus15.addEventListener('click', () => {
  selectedTimestamp = normalizeScheduledTimestamp(selectedTimestamp - 15 * 60000);
  updateDateTimeDisplay();
});

btnTimePlus60.addEventListener('click', () => {
  selectedTimestamp = normalizeScheduledTimestamp(selectedTimestamp + 60 * 60000);
  updateDateTimeDisplay();
});

/**
 * Tab Navigation Handlers
 */
function switchTab(tab) {
  activeTab = tab;
  if (tab === 'scheduled') {
    tabBtnScheduled.classList.add('active');
    tabBtnScheduled.setAttribute('aria-selected', 'true');
    tabBtnHistory.classList.remove('active');
    tabBtnHistory.setAttribute('aria-selected', 'false');
    scheduledSection.classList.remove('hidden');
    historySection.classList.add('hidden');
    renderScheduledTasks();
  } else {
    tabBtnHistory.classList.add('active');
    tabBtnHistory.setAttribute('aria-selected', 'true');
    tabBtnScheduled.classList.remove('active');
    tabBtnScheduled.setAttribute('aria-selected', 'false');
    historySection.classList.remove('hidden');
    scheduledSection.classList.add('hidden');
    renderHistoryTasks();
  }
}

tabBtnScheduled.addEventListener('click', () => switchTab('scheduled'));
tabBtnHistory.addEventListener('click', () => switchTab('history'));

/**
 * Render Pending Scheduled Tasks
 */
async function renderScheduledTasks() {
  try {
    const tasks = (await StorageService.getScheduledTasks())
      .filter(task => task.triggerTime > Date.now());
    tasks.sort((a, b) => a.triggerTime - b.triggerTime);

    scheduledCountBadge.textContent = String(tasks.length);

    if (tasks.length === 0) {
      scheduledTaskList.innerHTML = `
        <div class="empty-state-card">
          <svg class="empty-state-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 14 14"></polyline>
          </svg>
          <div class="empty-state-text">
            <strong>No tasks scheduled</strong><br>
            Add queries above to schedule automated searches.
          </div>
        </div>
      `;
      return;
    }

    scheduledTaskList.innerHTML = '';
    tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'task-card';

      const cardHeader = document.createElement('div');
      cardHeader.className = 'task-card-header';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'task-time';
      timeSpan.innerHTML = `
        <svg class="task-time-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        ${escapeHtml(formatDisplayDateTime(task.triggerTime))}
      `;

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.setAttribute('aria-label', `Cancel task scheduled for ${formatDisplayDateTime(task.triggerTime)}`);
      cancelBtn.addEventListener('click', async () => {
        await StorageService.cancelScheduledTask(task.id);
        showStatus('Task cancelled.', 'success');
        renderAll();
      });

      cardHeader.appendChild(timeSpan);
      cardHeader.appendChild(cancelBtn);

      const chipsContainer = document.createElement('div');
      chipsContainer.className = 'query-chips';

      task.queries.forEach(query => {
        const isYt = isYoutubeQuery(query, task.engine);
        const displayText = cleanQueryText(query);
        const chip = document.createElement('span');
        chip.className = `query-chip ${isYt ? 'youtube' : ''}`;
        chip.innerHTML = `
          ${isYt ? '<span class="engine-badge youtube">YT</span>' : ''}
          <svg class="query-chip-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>${escapeHtml(displayText)}</span>
        `;
        chipsContainer.appendChild(chip);
      });

      card.appendChild(cardHeader);
      card.appendChild(chipsContainer);
      scheduledTaskList.appendChild(card);
    });
  } catch (err) {
    console.error('Error rendering scheduled tasks:', err);
    showStatus('Failed to load tasks.', 'error');
  }
}

/**
 * Render History Tasks (Past 24 hours sliding window)
 */
async function renderHistoryTasks() {
  try {
    const history = await StorageService.getHistoryTasks();
    // Sort descending: most recently queried/triggered items first
    history.sort((a, b) => {
      const timeA = a.queriedAt || a.triggerTime || 0;
      const timeB = b.queriedAt || b.triggerTime || 0;
      return timeB - timeA;
    });

    historyCountBadge.textContent = String(history.length);
    historyToolbar.classList.toggle('hidden', history.length === 0);
    updateHistoryBulkControls(history);

    if (history.length === 0) {
      historyTaskList.innerHTML = `
        <div class="empty-state-card">
          <svg class="empty-state-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 14 14"></polyline>
          </svg>
          <div class="empty-state-text">
            <strong>No history yet</strong><br>
            Queries executed within the last 24 hours will appear here.
          </div>
        </div>
      `;
      return;
    }

    historyTaskList.innerHTML = '';
    history.forEach(item => {
      const card = document.createElement('div');
      card.className = 'task-card history-card';
      card.dataset.historyId = item.id;

      const cardHeader = document.createElement('div');
      cardHeader.className = 'task-card-header';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'task-time';

      const isRescheduled = Boolean(item.scheduledTaskId);

      if (isRescheduled) {
        timeSpan.innerHTML = `
          <span class="reschedule-tag">Scheduled</span>
          <span>${escapeHtml(formatDisplayDateTime(item.nextTriggerTime))}</span>
        `;
      } else {
        timeSpan.innerHTML = `
          <svg class="task-time-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>Queried ${escapeHtml(formatDisplayDateTime(item.queriedAt || item.triggerTime))}</span>
        `;
      }

      const actionContainer = document.createElement('div');
      actionContainer.className = 'task-actions';

      if (isRescheduled) {
        // Replaced with Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.title = 'Cancel rescheduled query';
        cancelBtn.addEventListener('click', async () => {
          await StorageService.cancelRescheduledHistoryItem(item.id);
          showStatus('Rescheduled query cancelled.', 'success');
          renderAll();
        });
        actionContainer.appendChild(cancelBtn);
      } else {
        const selectControl = document.createElement('input');
        selectControl.type = 'checkbox';
        selectControl.className = 'history-select';
        selectControl.checked = selectedHistoryIds.has(item.id);
        selectControl.setAttribute('aria-label', 'Select finished task');
        selectControl.addEventListener('change', () => {
          if (selectControl.checked) selectedHistoryIds.add(item.id);
          else selectedHistoryIds.delete(item.id);
          updateHistoryBulkControls(history);
        });

        const plus15Btn = document.createElement('button');
        plus15Btn.type = 'button';
        plus15Btn.className = 'btn-reschedule';
        plus15Btn.textContent = '+15m';
        plus15Btn.title = 'Reschedule 15 minutes from now';
        plus15Btn.addEventListener('click', async () => {
          await StorageService.rescheduleHistoryItem(item.id, 15);
          showStatus('Rescheduled for 15 minutes from now.', 'success');
          renderAll();
        });

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn-cancel';
        clearBtn.textContent = 'Clear';
        clearBtn.title = 'Remove finished task from history';
        clearBtn.addEventListener('click', async () => {
          await StorageService.removeHistoryItems([item.id]);
          selectedHistoryIds.delete(item.id);
          showStatus('Finished task cleared.', 'success');
          renderAll();
        });

        actionContainer.appendChild(selectControl);
        actionContainer.appendChild(plus15Btn);
        actionContainer.appendChild(clearBtn);
      }

      cardHeader.appendChild(timeSpan);
      cardHeader.appendChild(actionContainer);

      const chipsContainer = document.createElement('div');
      chipsContainer.className = 'query-chips';

      (item.queries || []).forEach(query => {
        const isYt = isYoutubeQuery(query, item.engine);
        const displayText = cleanQueryText(query);
        const chip = document.createElement('span');
        chip.className = `query-chip ${isYt ? 'youtube' : ''}`;
        chip.innerHTML = `
          ${isYt ? '<span class="engine-badge youtube">YT</span>' : ''}
          <svg class="query-chip-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>${escapeHtml(displayText)}</span>
        `;
        chipsContainer.appendChild(chip);
      });

      card.appendChild(cardHeader);
      card.appendChild(chipsContainer);
      historyTaskList.appendChild(card);
    });
  } catch (err) {
    console.error('Error rendering history tasks:', err);
    showStatus('Failed to load history.', 'error');
  }
}

selectAllHistory.addEventListener('change', () => {
  historyTaskList.querySelectorAll('.history-select').forEach(control => {
    control.checked = selectAllHistory.checked;
    const cardId = control.closest('.task-card').dataset.historyId;
    if (selectAllHistory.checked) selectedHistoryIds.add(cardId);
    else selectedHistoryIds.delete(cardId);
  });
  clearAllHistory.disabled = selectedHistoryIds.size === 0;
  selectAllHistory.indeterminate = false;
});

clearAllHistory.addEventListener('click', async () => {
  const count = selectedHistoryIds.size;
  await StorageService.removeHistoryItems([...selectedHistoryIds]);
  selectedHistoryIds.clear();
  showStatus(`${count} finished ${count === 1 ? 'task' : 'tasks'} cleared.`, 'success');
  renderAll();
});

/**
 * Re-render both views
 */
async function renderAll() {
  await Promise.all([renderScheduledTasks(), renderHistoryTasks()]);
}

/**
 * Form Submit Handler
 */
scheduleForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const rawInput = queryInput.value.trim();
  const queries = rawInput
    .split('\n')
    .map(q => q.trim())
    .filter(q => q.length > 0);

  if (queries.length === 0) {
    showStatus('Please enter at least one search query.', 'error');
    queryInput.focus();
    return;
  }

  selectedTimestamp = normalizeScheduledTimestamp(selectedTimestamp);
  const earliest = getEarliestValidTime();
  if (selectedTimestamp < earliest) {
    showStatus('Scheduled time must be at least 1 minute in the future.', 'error');
    return;
  }

  const engineRadio = document.querySelector('input[name="searchEngine"]:checked');
  const engine = engineRadio ? engineRadio.value : 'google';

  try {
    await StorageService.scheduleNewTask(queries, selectedTimestamp, engine);
    queryInput.value = '';
    showStatus(`Scheduled ${queries.length} ${queries.length === 1 ? 'query' : 'queries'} successfully!`, 'success');
    renderAll();
  } catch (err) {
    console.error('Error scheduling queries:', err);
    showStatus('Failed to schedule queries.', 'error');
  }
});

/**
 * XSS escaping helper
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initial setup on DOM ready
async function init() {
  await initializeScheduleTime();

  // Restore last selected search engine preference
  try {
    const savedEngine = await StorageService.getLastSelectedEngine();
    if (savedEngine) {
      const radio = document.querySelector(`input[name="searchEngine"][value="${savedEngine}"]`);
      if (radio) {
        radio.checked = true;
      }
    }
  } catch (e) {
    console.warn('Could not load saved search engine:', e);
  }

  // Persist search engine selection when changed
  const engineRadios = document.querySelectorAll('input[name="searchEngine"]');
  engineRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        StorageService.setLastSelectedEngine(radio.value);
      }
    });
  });

  await renderAll();

  // Storage listener: sync UI across instances
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if ((areaName === 'local' && changes.history_tasks) ||
          (areaName === 'sync' && changes.scheduled_tasks)) {
        renderAll();
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
