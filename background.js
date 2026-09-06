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
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Check if this is a 30-second fallback alarm
  if (alarm.name.startsWith('fallback_')) {
    const notifId = alarm.name.replace('fallback_', '');
    if (pendingNotifications.has(notifId)) {
      const payload = pendingNotifications.get(notifId);
      pendingNotifications.delete(notifId);
      try {
        await chrome.notifications.clear(notifId);
      } catch (e) {}
      await executeQueries(payload.queries);
    }
    return;
  }

  return StorageService.withStorageLock(async () => {
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
      console.log(`[rabbit-hole] Task ${alarm.name} moved to history (${history.length} total history items)`);

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

      // Fallback alarm in case service worker sleeps during the 30 seconds
      chrome.alarms.create(`fallback_${notifId}`, { delayInMinutes: 0.5 });

      pendingNotifications.set(notifId, {
        queries: task.queries,
        timeoutId
      });

      const iconPath = chrome.runtime.getURL('icons/icon48.png');
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: iconPath,
        title: `rabbit-hole: ${queryCount} ${queryCount === 1 ? 'Query' : 'Queries'} Ready`,
        message: queryPreview || 'Click to open search results',
        priority: 2,
        requireInteraction: true
      }, (createdId) => {
        if (chrome.runtime.lastError) {
          console.warn('[rabbit-hole] Notification creation failed, opening tabs directly:', chrome.runtime.lastError);
          clearTimeout(timeoutId);
          chrome.alarms.clear(`fallback_${notifId}`);
          pendingNotifications.delete(notifId);
          executeQueries(task.queries);
        }
      });
    } catch (error) {
      console.error('[rabbit-hole] Error handling alarm execution:', error);
    }
  });
});

/**
 * Handle notification click: immediately open tabs and cancel 30-second fallback
 */
chrome.notifications.onClicked.addListener(async (notifId) => {
  chrome.alarms.clear(`fallback_${notifId}`);
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
