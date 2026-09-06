/**
 * rabbit-hole - Background Service Worker
 */

importScripts('storage.js');

// Map of notification IDs to pending query payloads and fallback timeout IDs
const pendingNotifications = new Map();

/**
 * Open query search tabs in Chrome
 */
async function executeQueries(queries) {
  if (!Array.isArray(queries)) return;
  for (const query of queries) {
    if (query && query.trim()) {
      const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query.trim());
      await chrome.tabs.create({ url: searchUrl });
    }
  }
}

/**
 * Handle alarm triggering with atomic storage operations
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  StorageService.withStorageLock(async () => {
    try {
      const scheduledTasks = await StorageService.getScheduledTasks();
      const taskIndex = scheduledTasks.findIndex((t) => t.id === alarm.name);

      if (taskIndex === -1) {
        console.warn(`[rabbit-hole] No matching task found for alarm: ${alarm.name}`);
        return;
      }

      const task = scheduledTasks[taskIndex];

      // Remove executed task from scheduled queue
      scheduledTasks.splice(taskIndex, 1);
      await StorageService.setScheduledTasks(scheduledTasks);

      // Move into 24-hour history
      const history = await StorageService.getHistoryTasks();
      const now = Date.now();

      if (task.historyOriginId) {
        // If this task was a reschedule of an existing history item, update that item
        const orig = history.find(h => h.id === task.historyOriginId);
        if (orig) {
          orig.queriedAt = now;
          orig.scheduledTaskId = null;
          orig.nextTriggerTime = null;
        } else {
          history.unshift({
            id: task.id,
            queries: task.queries,
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
          triggerTime: task.triggerTime,
          queriedAt: now,
          scheduledTaskId: null,
          nextTriggerTime: null
        });
      }

      await StorageService.setHistoryTasks(history);

      // Set up notification & 30-second fallback to open tabs
      const notifId = `rabbit_hole_notif_${alarm.name}_${Date.now()}`;
      const queryCount = task.queries ? task.queries.length : 0;
      const queryPreview = (task.queries || []).slice(0, 3).join(', ') + (queryCount > 3 ? ` (+${queryCount - 3} more)` : '');

      const timeoutId = setTimeout(async () => {
        if (pendingNotifications.has(notifId)) {
          const payload = pendingNotifications.get(notifId);
          pendingNotifications.delete(notifId);
          try {
            await chrome.notifications.clear(notifId);
          } catch (e) {}
          await executeQueries(payload.queries);
        }
      }, 30000);

      pendingNotifications.set(notifId, {
        queries: task.queries,
        timeoutId
      });

      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icon.png',
        title: `rabbit-hole: ${queryCount} ${queryCount === 1 ? 'Query' : 'Queries'} Ready`,
        message: queryPreview || 'Click to open search results',
        priority: 2,
        requireInteraction: true
      });

      console.log(`[rabbit-hole] Executed task ${alarm.name}, notification sent with 30s auto-open fallback`);
    } catch (error) {
      console.error('[rabbit-hole] Error handling alarm execution:', error);
    }
  });
});

/**
 * Handle notification click: immediately open tabs and cancel 30-second fallback
 */
chrome.notifications.onClicked.addListener(async (notifId) => {
  if (pendingNotifications.has(notifId)) {
    const payload = pendingNotifications.get(notifId);
    clearTimeout(payload.timeoutId);
    pendingNotifications.delete(notifId);

    try {
      await chrome.notifications.clear(notifId);
    } catch (e) {}

    await executeQueries(payload.queries);
  }
});
