/**
 * rabbit-hole - Popup Controller
 */

// DOM Elements
const scheduleForm = document.getElementById('scheduleForm');
const queryInput = document.getElementById('queryInput');
const datetimeInput = document.getElementById('datetimeInput');
const taskListContainer = document.getElementById('taskList');
const pendingCountBadge = document.getElementById('pendingCountBadge');
const statusBanner = document.getElementById('statusBanner');

let bannerTimeoutId = null;

/**
 * Format a Date object to 'YYYY-MM-DDTHH:mm' suitable for datetime-local input
 */
function toLocalDateTimeString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Format timestamp for task card display
 */
function formatDisplayDateTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Display status notification banner
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
 * Reset form inputs to default state
 */
function resetFormInputs() {
  queryInput.value = '';
  const now = new Date();
  const minTime = toLocalDateTimeString(now);
  const defaultTime = toLocalDateTimeString(new Date(now.getTime() + 10 * 60 * 1000));

  datetimeInput.min = minTime;
  datetimeInput.value = defaultTime;
}

/**
 * Render pending tasks in the list container
 */
async function renderPendingTasks() {
  try {
    const data = await chrome.storage.local.get('scheduled_tasks');
    const tasks = data.scheduled_tasks || [];

    // Sort by triggerTime ascending
    tasks.sort((a, b) => a.triggerTime - b.triggerTime);

    // Update count badge
    pendingCountBadge.textContent = String(tasks.length);

    // Render empty state if no tasks
    if (tasks.length === 0) {
      taskListContainer.innerHTML = `
        <div class="empty-state-card">
          <svg class="empty-state-icon" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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

    // Render task cards
    taskListContainer.innerHTML = '';
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
      cancelBtn.addEventListener('click', () => cancelTask(task.id));

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
      taskListContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Error rendering pending tasks:', err);
    showStatus('Failed to load tasks.', 'error');
  }
}

/**
 * Cancel a scheduled task by ID
 */
async function cancelTask(taskId) {
  try {
    // Clear the alarm
    await chrome.alarms.clear(taskId);

    // Remove from chrome.storage.local
    const data = await chrome.storage.local.get('scheduled_tasks');
    const tasks = data.scheduled_tasks || [];
    const updatedTasks = tasks.filter(task => task.id !== taskId);
    await chrome.storage.local.set({ scheduled_tasks: updatedTasks });

    showStatus('Task cancelled successfully.', 'success');
    renderPendingTasks();
  } catch (err) {
    console.error('Error cancelling task:', err);
    showStatus('Failed to cancel task: ' + err.message, 'error');
  }
}

/**
 * Form submit handler
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  // 1. Split textarea input by lines and filter empty queries
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

  // 2. Parse datetime value and validate it is a future timestamp
  if (!datetimeInput.value) {
    showStatus('Please select a date and time.', 'error');
    datetimeInput.focus();
    return;
  }

  const triggerTime = new Date(datetimeInput.value).getTime();
  const now = Date.now();

  if (isNaN(triggerTime) || triggerTime <= now) {
    showStatus('Please select a valid future date and time.', 'error');
    datetimeInput.focus();
    return;
  }

  // 3. Generate a unique task ID
  const taskId = `query_alarm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    // 4. Create Chrome alarm
    await chrome.alarms.create(taskId, { when: triggerTime });

    // 5. Save task metadata under 'scheduled_tasks'
    const data = await chrome.storage.local.get('scheduled_tasks');
    const tasks = data.scheduled_tasks || [];

    const newTask = {
      id: taskId,
      triggerTime,
      queries,
      createdAt: Date.now()
    };

    tasks.push(newTask);
    await chrome.storage.local.set({ scheduled_tasks: tasks });

    // 6. Show feedback, clear inputs, and refresh pending list
    showStatus(`Scheduled ${queries.length} ${queries.length === 1 ? 'query' : 'queries'} successfully!`, 'success');
    resetFormInputs();
    renderPendingTasks();
  } catch (err) {
    console.error('Error scheduling task:', err);
    showStatus('Failed to schedule: ' + err.message, 'error');
  }
}

/**
 * Simple HTML escaping utility to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initial setup on DOM load
document.addEventListener('DOMContentLoaded', () => {
  resetFormInputs();
  renderPendingTasks();

  scheduleForm.addEventListener('submit', handleFormSubmit);

  // Storage listener: automatically refresh UI when storage updates
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.scheduled_tasks) {
      renderPendingTasks();
    }
  });
});

