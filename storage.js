/**
 * rabbit-hole - Storage & Task Management Module
 */

const STORAGE_KEYS = {
  SCHEDULED_TASKS: 'scheduled_tasks',
  HISTORY_TASKS: 'history_tasks',
  LAST_SCHEDULED_TIME: 'last_scheduled_time'
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Internal promise queue ensuring atomic read-modify-write operations
let _storageLock = Promise.resolve();

function withStorageLock(fn) {
  const result = _storageLock.then(fn, fn);
  _storageLock = result.catch(() => {});
  return result;
}

/**
 * Fetch scheduled tasks from storage
 */
async function getScheduledTasks() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SCHEDULED_TASKS);
  return data[STORAGE_KEYS.SCHEDULED_TASKS] || [];
}

/**
 * Save scheduled tasks to storage
 */
async function setScheduledTasks(tasks) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SCHEDULED_TASKS]: tasks });
}

/**
 * Fetch history tasks from storage, automatically pruning items older than 24 hours
 */
async function getHistoryTasks() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.HISTORY_TASKS);
  const history = data[STORAGE_KEYS.HISTORY_TASKS] || [];
  const now = Date.now();
  const validHistory = history.filter(item => (now - (item.queriedAt || item.triggerTime)) < ONE_DAY_MS);
  
  if (validHistory.length !== history.length) {
    await setHistoryTasks(validHistory);
  }
  return validHistory;
}

/**
 * Save history tasks to storage
 */
async function setHistoryTasks(tasks) {
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY_TASKS]: tasks });
}

/**
 * Get the last scheduled time saved by the user
 */
async function getLastScheduledTime() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_SCHEDULED_TIME);
  return data[STORAGE_KEYS.LAST_SCHEDULED_TIME] || null;
}

/**
 * Persist the last scheduled time
 */
async function setLastScheduledTime(timestamp) {
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SCHEDULED_TIME]: timestamp });
}

/**
 * Generate a unique task identifier
 */
function generateTaskId() {
  return `query_alarm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Atomically schedule a new task
 */
async function scheduleNewTask(queries, triggerTime) {
  return withStorageLock(async () => {
    const taskId = generateTaskId();
    await chrome.alarms.create(taskId, { when: triggerTime });

    const tasks = await getScheduledTasks();
    const newTask = {
      id: taskId,
      queries,
      triggerTime,
      createdAt: Date.now()
    };
    tasks.push(newTask);
    await setScheduledTasks(tasks);
    await setLastScheduledTime(triggerTime);

    return newTask;
  });
}

/**
 * Atomically cancel a scheduled task by its ID
 */
async function cancelScheduledTask(taskId) {
  return withStorageLock(async () => {
    await chrome.alarms.clear(taskId);

    const tasks = await getScheduledTasks();
    const updatedTasks = tasks.filter(t => t.id !== taskId);
    await setScheduledTasks(updatedTasks);

    // If this task was rescheduled from history, unlink it in history
    const history = await getHistoryTasks();
    let historyChanged = false;
    history.forEach(item => {
      if (item.scheduledTaskId === taskId) {
        item.scheduledTaskId = null;
        item.nextTriggerTime = null;
        historyChanged = true;
      }
    });

    if (historyChanged) {
      await setHistoryTasks(history);
    }

    return updatedTasks;
  });
}

/**
 * Reschedule a history task by adding minutes from current time
 */
async function rescheduleHistoryItem(historyId, additionalMinutes) {
  return withStorageLock(async () => {
    const history = await getHistoryTasks();
    const item = history.find(h => h.id === historyId);
    if (!item) {
      throw new Error(`History item ${historyId} not found`);
    }

    // If already rescheduled, cancel the previous scheduled alarm first
    if (item.scheduledTaskId) {
      await chrome.alarms.clear(item.scheduledTaskId);
      const scheduledTasks = await getScheduledTasks();
      await setScheduledTasks(scheduledTasks.filter(t => t.id !== item.scheduledTaskId));
    }

    const triggerTime = Date.now() + additionalMinutes * 60 * 1000;
    const newTaskId = generateTaskId();

    await chrome.alarms.create(newTaskId, { when: triggerTime });

    const scheduledTasks = await getScheduledTasks();
    scheduledTasks.push({
      id: newTaskId,
      queries: item.queries,
      triggerTime,
      createdAt: Date.now(),
      historyOriginId: historyId
    });
    await setScheduledTasks(scheduledTasks);

    item.scheduledTaskId = newTaskId;
    item.nextTriggerTime = triggerTime;
    await setHistoryTasks(history);
    await setLastScheduledTime(triggerTime);

    return { item, newTaskId, triggerTime };
  });
}

/**
 * Cancel a rescheduled history task
 */
async function cancelRescheduledHistoryItem(historyId) {
  return withStorageLock(async () => {
    const history = await getHistoryTasks();
    const item = history.find(h => h.id === historyId);
    if (!item || !item.scheduledTaskId) return;

    await chrome.alarms.clear(item.scheduledTaskId);

    const scheduledTasks = await getScheduledTasks();
    await setScheduledTasks(scheduledTasks.filter(t => t.id !== item.scheduledTaskId));

    item.scheduledTaskId = null;
    item.nextTriggerTime = null;
    await setHistoryTasks(history);
  });
}

// Expose on global scope for background service worker and popup scripts
const StorageService = {
  STORAGE_KEYS,
  ONE_DAY_MS,
  withStorageLock,
  getScheduledTasks,
  setScheduledTasks,
  getHistoryTasks,
  setHistoryTasks,
  getLastScheduledTime,
  setLastScheduledTime,
  scheduleNewTask,
  cancelScheduledTask,
  rescheduleHistoryItem,
  cancelRescheduledHistoryItem
};

if (typeof self !== 'undefined') {
  self.StorageService = StorageService;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageService;
}

