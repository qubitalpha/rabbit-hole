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
  const tasks = data[STORAGE_KEYS.SCHEDULED_TASKS];
  return Array.isArray(tasks) ? tasks : [];
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
  const history = Array.isArray(data[STORAGE_KEYS.HISTORY_TASKS]) ? data[STORAGE_KEYS.HISTORY_TASKS] : [];
  const now = Date.now();
  const validHistory = history.filter(item => {
    if (!item) return false;
    // For rescheduled items with a future trigger, keep them active
    if (item.scheduledTaskId && item.nextTriggerTime && item.nextTriggerTime > now) {
      return true;
    }
    const timestamp = item.queriedAt || item.triggerTime || now;
    return (now - timestamp) < ONE_DAY_MS;
  });
  
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
 * Saves metadata to storage BEFORE registering Chrome alarm to eliminate race conditions
 */
async function scheduleNewTask(queries, triggerTime, engine = 'google') {
  return withStorageLock(async () => {
    const taskId = generateTaskId();

    const tasks = await getScheduledTasks();
    const newTask = {
      id: taskId,
      queries,
      engine: engine || 'google',
      triggerTime,
      createdAt: Date.now()
    };
    tasks.push(newTask);
    await setScheduledTasks(tasks);
    await setLastScheduledTime(triggerTime);

    // Register alarm AFTER task data is persisted
    await chrome.alarms.create(taskId, { when: triggerTime });

    return newTask;
  });
}

/**
 * Atomically move an executed task from scheduled queue into 24-hour history.
 * Persists BOTH scheduled_tasks and history_tasks in a single atomic storage write.
 */
async function moveScheduledTaskToHistory(alarmName) {
  return withStorageLock(async () => {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.SCHEDULED_TASKS,
      STORAGE_KEYS.HISTORY_TASKS
    ]);

    const scheduledTasks = Array.isArray(data[STORAGE_KEYS.SCHEDULED_TASKS])
      ? data[STORAGE_KEYS.SCHEDULED_TASKS]
      : [];
    const taskIndex = scheduledTasks.findIndex((t) => t.id === alarmName);

    if (taskIndex === -1) {
      console.warn(`[rabbit-hole] No matching task found for alarm: ${alarmName}`);
      return null;
    }

    const [task] = scheduledTasks.splice(taskIndex, 1);
    const now = Date.now();

    const rawHistory = Array.isArray(data[STORAGE_KEYS.HISTORY_TASKS])
      ? data[STORAGE_KEYS.HISTORY_TASKS]
      : [];
    
    // Prune items older than 24h while keeping future-rescheduled items
    const history = rawHistory.filter(item => {
      if (!item) return false;
      if (item.scheduledTaskId && item.nextTriggerTime && item.nextTriggerTime > now) {
        return true;
      }
      const timestamp = item.queriedAt || item.triggerTime || now;
      return (now - timestamp) < ONE_DAY_MS;
    });

    if (task.historyOriginId) {
      // If this task was a reschedule of an existing history item, update and bring to top
      const origIndex = history.findIndex(h => h.id === task.historyOriginId);
      if (origIndex !== -1) {
        const [orig] = history.splice(origIndex, 1);
        orig.queriedAt = now;
        orig.scheduledTaskId = null;
        orig.nextTriggerTime = null;
        if (task.engine) orig.engine = task.engine;
        history.unshift(orig);
      } else {
        history.unshift({
          id: task.id,
          queries: task.queries,
          engine: task.engine || 'google',
          triggerTime: task.triggerTime,
          queriedAt: now,
          scheduledTaskId: null,
          nextTriggerTime: null
        });
      }
    } else {
      history.unshift({
        id: task.id,
        queries: task.queries,
        engine: task.engine || 'google',
        triggerTime: task.triggerTime,
        queriedAt: now,
        scheduledTaskId: null,
        nextTriggerTime: null
      });
    }

    // Atomic write to storage for both keys
    await chrome.storage.local.set({
      [STORAGE_KEYS.SCHEDULED_TASKS]: scheduledTasks,
      [STORAGE_KEYS.HISTORY_TASKS]: history
    });

    return task;
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

    const scheduledTasks = await getScheduledTasks();
    scheduledTasks.push({
      id: newTaskId,
      queries: item.queries,
      engine: item.engine || 'google',
      triggerTime,
      createdAt: Date.now(),
      historyOriginId: historyId
    });
    await setScheduledTasks(scheduledTasks);

    item.scheduledTaskId = newTaskId;
    item.nextTriggerTime = triggerTime;
    await setHistoryTasks(history);
    await setLastScheduledTime(triggerTime);

    // Register alarm AFTER task data is persisted
    await chrome.alarms.create(newTaskId, { when: triggerTime });

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
  moveScheduledTaskToHistory,
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
