const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Setup Chrome API mocks in global scope before requiring modules
function createChromeMock() {
  const localStore = {};
  const syncStore = {};
  const alarms = new Map();
  const createStorageArea = (store) => ({
    get: async (keys) => {
      await new Promise((r) => setTimeout(r, 2));
      if (!keys) return JSON.parse(JSON.stringify(store));
      if (typeof keys === 'string') {
        return { [keys]: store[keys] === undefined ? undefined : JSON.parse(JSON.stringify(store[keys])) };
      }
      if (Array.isArray(keys)) {
        const result = {};
        keys.forEach((key) => {
          if (store[key] !== undefined) result[key] = JSON.parse(JSON.stringify(store[key]));
        });
        return result;
      }
      const result = {};
      for (const key of Object.keys(keys)) result[key] = store[key] === undefined ? keys[key] : JSON.parse(JSON.stringify(store[key]));
      return result;
    },
    set: async (items) => {
      await new Promise((r) => setTimeout(r, 2));
      for (const [key, value] of Object.entries(items)) store[key] = JSON.parse(JSON.stringify(value));
    },
    _store: store
  });

  return {
    storage: {
      local: createStorageArea(localStore),
      sync: createStorageArea(syncStore)
    },
    alarms: {
      create: async (name, info) => {
        alarms.set(name, info);
      },
      clear: async (name) => {
        alarms.delete(name);
      },
      getAll: async () => [...alarms.entries()].map(([name, info]) => ({ name, ...info })),
      _alarms: alarms
    },
    tabs: {
      create: async (info) => {
        return { id: Math.floor(Math.random() * 1000), ...info };
      }
    },
    notifications: {
      create: (id, options, cb) => {
        if (cb) cb(id);
      },
      clear: async (id) => {}
    },
    runtime: {
      getURL: (path) => path,
      lastError: null
    }
  };
}

// Attach mock chrome before loading modules
global.chrome = createChromeMock();

const StorageService = require('../storage.js');
const { getSearchUrl } = require('../background.js');

describe('Rabbit Hole - Core Regression & Concurrency Tests', () => {
  beforeEach(() => {
    global.chrome = createChromeMock();
  });

  describe('Search URL Routing (Google & YouTube)', () => {
    test('routes standard query to Google by default', () => {
      const url = getSearchUrl('javascript promises');
      assert.equal(url, 'https://www.google.com/search?q=javascript%20promises');
    });

    test('routes query with youtube engine to YouTube', () => {
      const url = getSearchUrl('lo-fi hip hop', 'youtube');
      assert.equal(url, 'https://www.youtube.com/results?search_query=lo-fi%20hip%20hop');
    });

    test('overrides default engine with yt: prefix', () => {
      const url = getSearchUrl('yt: coding tutorial in python', 'google');
      assert.equal(url, 'https://www.youtube.com/results?search_query=coding%20tutorial%20in%20python');
    });

    test('overrides default engine with youtube: prefix (case-insensitive)', () => {
      const url = getSearchUrl('YouTube:  space documentary ');
      assert.equal(url, 'https://www.youtube.com/results?search_query=space%20documentary');
    });

    test('overrides default engine with yt space prefix (no colon)', () => {
      const url = getSearchUrl('yt coding tutorial in python', 'google');
      assert.equal(url, 'https://www.youtube.com/results?search_query=coding%20tutorial%20in%20python');
    });

    test('overrides default engine with youtube space prefix (no colon)', () => {
      const url = getSearchUrl('youtube space documentary', 'google');
      assert.equal(url, 'https://www.youtube.com/results?search_query=space%20documentary');
    });

    test('opens bare youtube and video URLs directly as https', () => {
      assert.equal(getSearchUrl('youtube.com/watch?v=dQw4w9WgXcQ'), 'https://youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(getSearchUrl('www.youtube.com/results?search_query=test'), 'https://www.youtube.com/results?search_query=test');
      assert.equal(getSearchUrl('youtu.be/dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ');
    });

    test('routes standalone yt or youtube keywords to YouTube home', () => {
      assert.equal(getSearchUrl('yt'), 'https://www.youtube.com');
      assert.equal(getSearchUrl('YouTube'), 'https://www.youtube.com');
    });

    test('routes g: or google: prefixes to Google search', () => {
      assert.equal(getSearchUrl('g: artificial intelligence', 'youtube'), 'https://www.google.com/search?q=artificial%20intelligence');
      assert.equal(getSearchUrl('google machine learning', 'youtube'), 'https://www.google.com/search?q=machine%20learning');
      assert.equal(getSearchUrl('google'), 'https://www.google.com');
    });

    test('preserves direct HTTP and HTTPS URLs', () => {
      const httpsUrl = getSearchUrl('https://github.com/trending');
      assert.equal(httpsUrl, 'https://github.com/trending');

      const httpUrl = getSearchUrl('http://example.com/test?a=1&b=2');
      assert.equal(httpUrl, 'http://example.com/test?a=1&b=2');
    });

    test('handles empty or blank inputs gracefully', () => {
      assert.equal(getSearchUrl(''), '');
      assert.equal(getSearchUrl('   '), '');
    });
  });

  describe('Bug Fix 1: Single Task Moves to History on Execution', () => {
    test('task remains synced while moving into this device history', async () => {
      const triggerTime = Date.now() + 60000;
      const scheduled = await StorageService.scheduleNewTask(['quantum computing'], triggerTime, 'google');
      assert.ok(scheduled.id);

      // Verify task exists in scheduled tasks
      let scheduledTasks = await StorageService.getScheduledTasks();
      assert.equal(scheduledTasks.length, 1);
      assert.equal(scheduledTasks[0].id, scheduled.id);

      // Execute alarm
      const executed = await StorageService.moveScheduledTaskToHistory(scheduled.id);
      assert.ok(executed);
      assert.equal(executed.id, scheduled.id);

      // Keep the shared task so other active devices can execute it too.
      scheduledTasks = await StorageService.getScheduledTasks();
      assert.equal(scheduledTasks.length, 1);

      // Verify task is now in history
      const history = await StorageService.getHistoryTasks();
      assert.equal(history.length, 1);
      assert.equal(history[0].id, scheduled.id);
      assert.deepEqual(history[0].queries, ['quantum computing']);
      assert.equal(history[0].engine, 'google');
      assert.ok(history[0].queriedAt);
    });
  });

  describe('History retention and clearing', () => {
    test('prunes expired completed history and schedules cleanup for the next item', async () => {
      const now = Date.now();
      await StorageService.setHistoryTasks([
        { id: 'expired', queries: ['old'], queriedAt: now - StorageService.ONE_DAY_MS - 1 },
        { id: 'current', queries: ['new'], queriedAt: now - 1000 }
      ]);

      const history = await StorageService.pruneHistoryTasks();
      assert.deepEqual(history.map(item => item.id), ['current']);
      assert.ok(global.chrome.alarms._alarms.has(StorageService.HISTORY_CLEANUP_ALARM));
    });

    test('removes only the selected completed history items', async () => {
      const now = Date.now();
      await StorageService.setHistoryTasks([
        { id: 'remove-me', queries: ['a'], queriedAt: now },
        { id: 'keep-me', queries: ['b'], queriedAt: now }
      ]);

      const removed = await StorageService.removeHistoryItems(['remove-me']);
      assert.deepEqual(removed.map(item => item.id), ['remove-me']);
      const remaining = await StorageService.getHistoryTasks();
      assert.deepEqual(remaining.map(item => item.id), ['keep-me']);
    });
  });

  describe('Cross-device task synchronization', () => {
    test('migrates existing local scheduled tasks to synced storage and restores alarms', async () => {
      const task = { id: 'query_alarm_existing', queries: ['sync me'], triggerTime: Date.now() + 60000 };
      await global.chrome.storage.local.set({ [StorageService.STORAGE_KEYS.SCHEDULED_TASKS]: [task] });

      await StorageService.migrateScheduledTasksToSync();
      await StorageService.restoreScheduledAlarms();

      assert.deepEqual(await StorageService.getScheduledTasks(), [task]);
      assert.ok(global.chrome.alarms._alarms.has(task.id));
    });
  });

  describe('Bug Fix 2: Multi-Task Concurrent Execution Clearing', () => {
    test('all concurrent tasks at identical time remain shared and move to local history', async () => {
      const now = Date.now();
      const triggerTime = now + 10000;

      // Schedule 5 tasks at the same time
      const taskCount = 5;
      const tasks = [];
      for (let i = 1; i <= taskCount; i++) {
        const task = await StorageService.scheduleNewTask(
          [`query ${i}A`, `query ${i}B`],
          triggerTime,
          i % 2 === 0 ? 'youtube' : 'google'
        );
        tasks.push(task);
      }

      // Verify all 5 tasks are scheduled
      let scheduledTasks = await StorageService.getScheduledTasks();
      assert.equal(scheduledTasks.length, taskCount);

      // Simulate simultaneous alarm triggers for all 5 tasks at the same instant
      const executionPromises = tasks.map((task) =>
        StorageService.moveScheduledTaskToHistory(task.id)
      );

      const executedTasks = await Promise.all(executionPromises);

      // Verify all executed tasks returned valid objects
      assert.equal(executedTasks.length, taskCount);
      executedTasks.forEach((t, idx) => {
        assert.ok(t, `Task ${idx} should have been processed`);
      });

      // Scheduled tasks stay synced for other devices to execute.
      scheduledTasks = await StorageService.getScheduledTasks();
      assert.equal(
        scheduledTasks.length,
        taskCount,
        `Expected ${taskCount} shared tasks remaining, found ${scheduledTasks.length}`
      );

      // History must now contain all 5 tasks
      const history = await StorageService.getHistoryTasks();
      assert.equal(
        history.length,
        taskCount,
        `Expected ${taskCount} history tasks, found ${history.length}`
      );

      const historyIds = new Set(history.map((h) => h.id));
      tasks.forEach((t) => {
        assert.ok(historyIds.has(t.id), `Task ${t.id} must be in history`);
      });
    });
  });

  describe('History Pruning & Rescheduling', () => {
    test('prunes history items older than 24 hours', async () => {
      const now = Date.now();
      const oldTime = now - 25 * 60 * 60 * 1000; // 25 hours ago
      const recentTime = now - 2 * 60 * 60 * 1000; // 2 hours ago

      await chrome.storage.local.set({
        [StorageService.STORAGE_KEYS.HISTORY_TASKS]: [
          { id: 'old_1', queries: ['old query'], queriedAt: oldTime },
          { id: 'recent_1', queries: ['recent query'], queriedAt: recentTime }
        ]
      });

      const history = await StorageService.getHistoryTasks();
      assert.equal(history.length, 1);
      assert.equal(history[0].id, 'recent_1');
    });

    test('preserves rescheduled items with future trigger time even if original queriedAt > 24h', async () => {
      const now = Date.now();
      const oldTime = now - 30 * 60 * 60 * 1000; // 30 hours ago
      const futureTrigger = now + 20 * 60 * 1000; // in 20 minutes

      await chrome.storage.local.set({
        [StorageService.STORAGE_KEYS.HISTORY_TASKS]: [
          {
            id: 'rescheduled_old',
            queries: ['preserve me'],
            queriedAt: oldTime,
            scheduledTaskId: 'query_alarm_123',
            nextTriggerTime: futureTrigger
          }
        ]
      });

      const history = await StorageService.getHistoryTasks();
      assert.equal(history.length, 1);
      assert.equal(history[0].id, 'rescheduled_old');
    });

    test('rescheduling an item creates new scheduled task with origin linkage', async () => {
      const now = Date.now();
      await chrome.storage.local.set({
        [StorageService.STORAGE_KEYS.HISTORY_TASKS]: [
          {
            id: 'history_item_1',
            queries: ['research deep learning'],
            engine: 'google',
            queriedAt: now - 3600000
          }
        ]
      });

      const { item, newTaskId, triggerTime } = await StorageService.rescheduleHistoryItem('history_item_1', 15);
      assert.ok(newTaskId);
      assert.ok(triggerTime > now);
      assert.equal(new Date(triggerTime).getSeconds(), 0, 'Trigger time seconds must be 0');
      assert.equal(new Date(triggerTime).getMilliseconds(), 0, 'Trigger time milliseconds must be 0');

      // Verify scheduled task was created with historyOriginId
      const scheduledTasks = await StorageService.getScheduledTasks();
      assert.equal(scheduledTasks.length, 1);
      assert.equal(scheduledTasks[0].historyOriginId, 'history_item_1');

      // Execute rescheduled task alarm
      await StorageService.moveScheduledTaskToHistory(newTaskId);

      // History should still have 1 item, updated and brought to top
      const history = await StorageService.getHistoryTasks();
      assert.equal(history.length, 1);
      assert.equal(history[0].id, 'history_item_1');
      assert.equal(history[0].scheduledTaskId, null);
      assert.equal(history[0].nextTriggerTime, null);
    });
  });

  describe('Engine Persistence & Smart Resolution', () => {
    test('persists and retrieves last selected search engine', async () => {
      assert.equal(await StorageService.getLastSelectedEngine(), 'google');
      await StorageService.setLastSelectedEngine('youtube');
      assert.equal(await StorageService.getLastSelectedEngine(), 'youtube');
      await StorageService.setLastSelectedEngine('google');
      assert.equal(await StorageService.getLastSelectedEngine(), 'google');
    });

    test('auto-detects youtube engine when scheduling tasks with youtube prefixes', async () => {
      const task = await StorageService.scheduleNewTask(['yt lofi chill'], Date.now() + 60000, 'google');
      assert.equal(task.engine, 'youtube');
    });

    test('preserves youtube engine when rescheduling history item without explicit engine', async () => {
      const now = Date.now();
      await chrome.storage.local.set({
        [StorageService.STORAGE_KEYS.HISTORY_TASKS]: [
          {
            id: 'yt_history_1',
            queries: ['youtube: interstellar soundtrack'],
            queriedAt: now - 3600000
          }
        ]
      });

      const { newTaskId } = await StorageService.rescheduleHistoryItem('yt_history_1', 15);
      const scheduledTasks = await StorageService.getScheduledTasks();
      const task = scheduledTasks.find(t => t.id === newTaskId);
      assert.ok(task);
      assert.equal(task.engine, 'youtube');
    });
  });

  describe('Task Cancellation', () => {
    test('cancelling a scheduled task removes it from storage and clears alarm', async () => {
      const task = await StorageService.scheduleNewTask(['cancel test'], Date.now() + 60000);
      assert.ok(chrome.alarms._alarms.has(task.id));

      await StorageService.cancelScheduledTask(task.id);

      const scheduled = await StorageService.getScheduledTasks();
      assert.equal(scheduled.length, 0);
      assert.ok(!chrome.alarms._alarms.has(task.id));
    });
  });
});
