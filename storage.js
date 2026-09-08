/**
 * rabbit-hole - Storage & Task Management Module
 */

const STORAGE_KEYS = {
  SCHEDULED_TASKS: 'scheduled_tasks',
  HISTORY_TASKS: 'history_tasks',
  SCHEDULED_TASKS_SYNC_MIGRATED: 'scheduled_tasks_sync_migrated',
  LAST_SCHEDULED_TIME: 'last_scheduled_time',
  LAST_SELECTED_ENGINE: 'last_selected_engine'
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_CLEANUP_ALARM = 'rabbit_hole_history_cleanup';
const TASK_ALARM_PREFIX = 'query_alarm_';

// Internal promise queue ensuring atomic read-modify-write operations
let _storageLock = Promise.resolve();

function withStorageLock(fn) {
  const result = _storageLock.then(fn, fn);
  _storageLock = result.catch(() => {});
  return result;
}

/**
 * Fetch shared scheduled tasks. Task definitions sync between Chrome profiles;
 * execution history remains local to each device.
 */
async function getScheduledTasks() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.SCHEDULED_TASKS);
  const tasks = data[STORAGE_KEYS.SCHEDULED_TASKS];
  return Array.isArray(tasks) ? tasks : [];
}

/**
 * Save scheduled tasks to storage
 */
async function setScheduledTasks(tasks) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SCHEDULED_TASKS]: tasks });
}

/** Copy existing pre-sync tasks once, without overwriting tasks from another device. */
async function migrateScheduledTasksToSync() {
  return withStorageLock(async () => {
    const [localData, syncData] = await Promise.all([
      chrome.storage.local.get([
        STORAGE_KEYS.SCHEDULED_TASKS,
        STORAGE_KEYS.SCHEDULED_TASKS_SYNC_MIGRATED
      ]),
      chrome.storage.sync.get(STORAGE_KEYS.SCHEDULED_TASKS)
    ]);
    if (localData[STORAGE_KEYS.SCHEDULED_TASKS_SYNC_MIGRATED]) {
      return Array.isArray(syncData[STORAGE_KEYS.SCHEDULED_TASKS])
        ? syncData[STORAGE_KEYS.SCHEDULED_TASKS]
        : [];
    }
    const localTasks = Array.isArray(localData[STORAGE_KEYS.SCHEDULED_TASKS])
      ? localData[STORAGE_KEYS.SCHEDULED_TASKS]
      : [];
    const syncTasks = Array.isArray(syncData[STORAGE_KEYS.SCHEDULED_TASKS])
      ? syncData[STORAGE_KEYS.SCHEDULED_TASKS]
      : [];
    const merged = [...syncTasks];
    const knownIds = new Set(syncTasks.map(task => task.id));
    localTasks.forEach(task => {
      if (!knownIds.has(task.id)) merged.push(task);
    });
    if (merged.length !== syncTasks.length) await setScheduledTasks(merged);
    await chrome.storage.local.set({ [STORAGE_KEYS.SCHEDULED_TASKS_SYNC_MIGRATED]: true });
    return merged;
  });
}

/** Recreate this device's alarms from the shared task list. */
async function restoreScheduledAlarms() {
  const tasks = await getScheduledTasks();
  const now = Date.now();
  const activeTasks = tasks.filter(task => task && task.triggerTime > now);
  const desiredIds = new Set(activeTasks.map(task => task.id));
  const alarms = await chrome.alarms.getAll();

  await Promise.all(alarms
    .filter(alarm => alarm.name.startsWith(TASK_ALARM_PREFIX) && !desiredIds.has(alarm.name))
    .map(alarm => chrome.alarms.clear(alarm.name)));
  await Promise.all(activeTasks
    .filter(task => !alarms.some(alarm => alarm.name === task.id))
    .map(task => chrome.alarms.create(task.id, { when: task.triggerTime, persistAcrossSessions: true })));
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
 * Remove expired history and schedule the next exact expiry.  This lets
 * history disappear even when the popup is never opened.
 */
async function pruneHistoryTasks() {
  return withStorageLock(async () => {
    const data = await chrome.storage.local.get(STORAGE_KEYS.HISTORY_TASKS);
    const history = Array.isArray(data[STORAGE_KEYS.HISTORY_TASKS])
      ? data[STORAGE_KEYS.HISTORY_TASKS]
      : [];
    const now = Date.now();
    const validHistory = history.filter(item => {
      if (!item) return false;
      if (item.scheduledTaskId && item.nextTriggerTime && item.nextTriggerTime > now) return true;
      const timestamp = item.queriedAt || item.triggerTime || now;
      return (now - timestamp) < ONE_DAY_MS;
    });
    if (validHistory.length !== history.length) await setHistoryTasks(validHistory);
    await scheduleHistoryCleanup(validHistory);
    return validHistory;
  });
}

/** Remove shared task definitions one day after their scheduled time. */
async function pruneExpiredScheduledTasks() {
  return withStorageLock(async () => {
    const now = Date.now();
    const tasks = await getScheduledTasks();
    const validTasks = tasks.filter(task => task && task.triggerTime >= now - ONE_DAY_MS);
    if (validTasks.length !== tasks.length) await setScheduledTasks(validTasks);
    await scheduleHistoryCleanup([]);
    return validTasks;
  });
}

/** Schedule a one-off alarm for the next completed-history expiry. */
async function scheduleHistoryCleanup(history) {
  if (!chrome.alarms) return;
  const now = Date.now();
  const historyExpiryTimes = history
    .filter(item => !(item.scheduledTaskId && item.nextTriggerTime && item.nextTriggerTime > now))
    .map(item => (item.queriedAt || item.triggerTime || now) + ONE_DAY_MS)
    .filter(time => time > now);
  const scheduledExpiryTimes = (await getScheduledTasks())
    .filter(task => task && task.triggerTime + ONE_DAY_MS > now)
    .map(task => task.triggerTime + ONE_DAY_MS);
  const expiryTimes = [...historyExpiryTimes, ...scheduledExpiryTimes];

  await chrome.alarms.clear(HISTORY_CLEANUP_ALARM);
  if (expiryTimes.length > 0) {
    await chrome.alarms.create(HISTORY_CLEANUP_ALARM, { when: Math.min(...expiryTimes) });
  }
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
 * Get the last selected search engine
 */
async function getLastSelectedEngine() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_SELECTED_ENGINE);
  return data[STORAGE_KEYS.LAST_SELECTED_ENGINE] || 'google';
}

/**
 * Persist the last selected search engine
 */
async function setLastSelectedEngine(engine) {
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SELECTED_ENGINE]: engine || 'google' });
}

/**
 * Detect engine from queries if not explicitly specified as youtube
 */
function resolveEngine(engine, queries) {
  if (engine === 'youtube') return 'youtube';
  if (Array.isArray(queries) && queries.length > 0) {
    const hasYoutubeQuery = queries.some(q => {
      if (typeof q !== 'string') return false;
      const trimmed = q.trim();
      return /^(?:yt|youtube)(?::|\s+)/i.test(trimmed) ||
             /^(?:yt|youtube)$/i.test(trimmed) ||
             /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(trimmed);
    });
    if (hasYoutubeQuery && (!engine || engine === 'google')) {
      return 'youtube';
    }
  }
  return engine || 'google';
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
    const resolvedEngine = resolveEngine(engine, queries);

    const tasks = await getScheduledTasks();
    const newTask = {
      id: taskId,
      queries,
      engine: resolvedEngine,
      triggerTime,
      createdAt: Date.now()
    };
    tasks.push(newTask);
    await setScheduledTasks(tasks);
    await setLastScheduledTime(triggerTime);
    await setLastSelectedEngine(engine || resolvedEngine);
    await scheduleHistoryCleanup([]);

    // Register alarm AFTER task data is persisted
    await chrome.alarms.create(taskId, { when: triggerTime, persistAcrossSessions: true });

    return newTask;
  });
}

/**
 * Record an execution in this device's 24-hour history. The shared task stays
 * available so every other active device can execute its own local alarm.
 */
async function moveScheduledTaskToHistory(alarmName) {
  return withStorageLock(async () => {
    const [scheduledTasks, data] = await Promise.all([
      getScheduledTasks(),
      chrome.storage.local.get(STORAGE_KEYS.HISTORY_TASKS)
    ]);
    const task = scheduledTasks.find((t) => t.id === alarmName);
    if (!task) {
      console.warn(`[rabbit-hole] No matching task found for alarm: ${alarmName}`);
      return null;
    }
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

    // An alarm can be delivered more than once after a browser wake/restart.
    if (history.some(item => item.id === task.id && !task.historyOriginId)) {
      return null;
    }

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

    await setHistoryTasks(history);
    await scheduleHistoryCleanup(history);

    return task;
  });
}

/** Remove completed history items by ID. */
async function removeHistoryItems(historyIds) {
  return withStorageLock(async () => {
    const ids = new Set(historyIds);
    if (ids.size === 0) return [];

    const history = await getHistoryTasks();
    const removed = history.filter(item => ids.has(item.id) && !item.scheduledTaskId);
    const remaining = history.filter(item => !ids.has(item.id) || item.scheduledTaskId);
    await setHistoryTasks(remaining);
    await scheduleHistoryCleanup(remaining);
    return removed;
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

    const now = Date.now();
    const target = new Date(now + additionalMinutes * 60 * 1000);
    target.setSeconds(0, 0);
    if (target.getTime() < now + 60000) {
      target.setMinutes(target.getMinutes() + 1);
    }
    const triggerTime = target.getTime();
    const newTaskId = generateTaskId();

    const resolvedEngine = resolveEngine(item.engine, item.queries);

    const scheduledTasks = await getScheduledTasks();
    scheduledTasks.push({
      id: newTaskId,
      queries: item.queries,
      engine: resolvedEngine,
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
    await chrome.alarms.create(newTaskId, { when: triggerTime, persistAcrossSessions: true });

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
  HISTORY_CLEANUP_ALARM,
  TASK_ALARM_PREFIX,
  withStorageLock,
  getScheduledTasks,
  setScheduledTasks,
  migrateScheduledTasksToSync,
  restoreScheduledAlarms,
  getHistoryTasks,
  pruneHistoryTasks,
  pruneExpiredScheduledTasks,
  setHistoryTasks,
  getLastScheduledTime,
  setLastScheduledTime,
  getLastSelectedEngine,
  setLastSelectedEngine,
  resolveEngine,
  scheduleNewTask,
  moveScheduledTaskToHistory,
  removeHistoryItems,
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
