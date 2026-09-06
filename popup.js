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
const scheduledCountBadge = document.getElementById('scheduledCountBadge');
const historyCountBadge = document.getElementById('historyCountBadge');

let bannerTimeoutId = null;
let selectedTimestamp = Date.now() + 15 * 60 * 1000;
let activeTab = 'scheduled'; // 'scheduled' | 'history'

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
 * Update the Target Date & Time display elements
 */
function updateDateTimeDisplay() {
  const now = Date.now();
  // Clamped to at least 1 minute from now
  if (selectedTimestamp < now + 60000) {
    selectedTimestamp = now + 15 * 60000;
  }
  dtDisplayText.textContent = formatDisplayDateTime(selectedTimestamp);
  dtRelativeText.textContent = formatRelativeTime(selectedTimestamp);
}

/**
 * Initialize target date & time based on saved user preference
 */
async function initializeScheduleTime() {
  const lastTime = await StorageService.getLastScheduledTime();
  const now = Date.now();
  if (lastTime && lastTime > now + 60000) {
    selectedTimestamp = lastTime;
  } else {
    selectedTimestamp = now + 15 * 60000;
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

  // If already past today, set to 15m from now
  if (target.getTime() <= Date.now()) {
    selectedTimestamp = Date.now() + 15 * 60000;
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
    if (target.getTime() <= Date.now()) {
      // If already past today's time on Saturday, target next Saturday morning 9am
      target.setDate(target.getDate() + 7);
      target.setHours(9, 0, 0, 0);
    }
  } else {
    target.setDate(now.getDate() + daysUntilSaturday);
    target.setHours(current.getHours() || 9, current.getMinutes() || 0, 0, 0);
  }

  selectedTimestamp = target.getTime();
  updateDateTimeDisplay();
});

btnDatePlus1.addEventListener('click', () => {
  const target = new Date(selectedTimestamp);
  target.setDate(target.getDate() + 1);
  selectedTimestamp = target.getTime();
  updateDateTimeDisplay();
});

btnTimePlus15.addEventListener('click', () => {
  selectedTimestamp += 15 * 60000;
  updateDateTimeDisplay();
});

btnTimeMinus15.addEventListener('click', () => {
  const minTime = Date.now() + 60000; // Minimum 1 minute in future
  selectedTimestamp = Math.max(minTime, selectedTimestamp - 15 * 60000);
  updateDateTimeDisplay();
});

btnTimePlus60.addEventListener('click', () => {
  selectedTimestamp += 60 * 60000;
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
  } else {
    tabBtnHistory.classList.add('active');
    tabBtnHistory.setAttribute('aria-selected', 'true');
    tabBtnScheduled.classList.remove('active');
    tabBtnScheduled.setAttribute('aria-selected', 'false');
    historySection.classList.remove('hidden');
    scheduledSection.classList.add('hidden');
  }
}

tabBtnScheduled.addEventListener('click', () => switchTab('scheduled'));
tabBtnHistory.addEventListener('click', () => switchTab('history'));

/**
 * Render Pending Scheduled Tasks
 */
async function renderScheduledTasks() {
  try {
    const tasks = await StorageService.getScheduledTasks();
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
        const chip = document.createElement('span');
        chip.className = 'query-chip';
        chip.innerHTML = `
          <svg class="query-chip-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>${escapeHtml(query)}</span>
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
    historyCountBadge.textContent = String(history.length);

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
        // +15m and +1h buttons
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

        const plus60Btn = document.createElement('button');
        plus60Btn.type = 'button';
        plus60Btn.className = 'btn-reschedule';
        plus60Btn.textContent = '+1h';
        plus60Btn.title = 'Reschedule 1 hour from now';
        plus60Btn.addEventListener('click', async () => {
          await StorageService.rescheduleHistoryItem(item.id, 60);
          showStatus('Rescheduled for 1 hour from now.', 'success');
          renderAll();
        });

        actionContainer.appendChild(plus15Btn);
        actionContainer.appendChild(plus60Btn);
      }

      cardHeader.appendChild(timeSpan);
      cardHeader.appendChild(actionContainer);

      const chipsContainer = document.createElement('div');
      chipsContainer.className = 'query-chips';

      (item.queries || []).forEach(query => {
        const chip = document.createElement('span');
        chip.className = 'query-chip';
        chip.innerHTML = `
          <svg class="query-chip-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>${escapeHtml(query)}</span>
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

  const now = Date.now();
  if (selectedTimestamp <= now) {
    showStatus('Scheduled time must be in the future.', 'error');
    return;
  }

  try {
    await StorageService.scheduleNewTask(queries, selectedTimestamp);
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
document.addEventListener('DOMContentLoaded', async () => {
  await initializeScheduleTime();
  await renderAll();

  // Storage listener: sync UI across instances
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.scheduled_tasks || changes.history_tasks) {
        renderAll();
      }
    }
  });
});
