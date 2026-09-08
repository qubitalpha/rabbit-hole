/**
 * rabbit-hole - Background Service Worker
 */

if (typeof importScripts === 'function') {
  importScripts('storage.js');
}

/**
 * Determine the appropriate search or navigation URL based on query content and engine
 * @param {string} query
 * @param {'google'|'youtube'} defaultEngine
 * @returns {string}
 */
function getSearchUrl(query, defaultEngine = 'google') {
  if (!query) return '';
  const trimmed = query.trim();
  if (!trimmed) return '';

  // Direct protocol URL (http:// or https://)
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Bare domain URL (e.g. youtube.com/watch?v=..., youtu.be/..., github.com, etc.)
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(trimmed)) {
    return 'https://' + trimmed;
  }

  // Explicit YouTube prefix: yt: query, youtube: query, yt query, youtube query
  if (/^(?:yt|youtube)(?::|\s+)/i.test(trimmed)) {
    const cleanQuery = trimmed.replace(/^(?:yt|youtube)(?::|\s*)/i, '').trim();
    if (!cleanQuery) {
      return 'https://www.youtube.com';
    }
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(cleanQuery);
  }

  // Pure keyword "yt" or "youtube"
  if (/^(?:yt|youtube)$/i.test(trimmed)) {
    return 'https://www.youtube.com';
  }

  // Explicit Google prefix: g: query, google: query, g query, google query
  if (/^(?:google|g)(?::|\s+)/i.test(trimmed)) {
    const cleanQuery = trimmed.replace(/^(?:google|g)(?::|\s+)/i, '').trim();
    if (!cleanQuery) {
      return 'https://www.google.com';
    }
    return 'https://www.google.com/search?q=' + encodeURIComponent(cleanQuery);
  }

  // Pure keyword "g" or "google"
  if (/^(?:google|g)$/i.test(trimmed)) {
    return 'https://www.google.com';
  }

  // Fallback to default engine
  if (defaultEngine === 'youtube') {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(trimmed);
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(trimmed);
}

/**
 * Open query search tabs in Chrome
 * @param {string[]} queries
 * @param {'google'|'youtube'} defaultEngine
 */
async function executeQueries(queries, defaultEngine = 'google') {
  if (!Array.isArray(queries)) return;
  for (const query of queries) {
    if (query && query.trim()) {
      const searchUrl = getSearchUrl(query, defaultEngine);
      if (searchUrl && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        await chrome.tabs.create({ url: searchUrl });
      }
    }
  }
}

/**
 * Handle alarm triggering with atomic storage operations and query execution
 */
if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
      if (alarm.name === StorageService.HISTORY_CLEANUP_ALARM) {
        await StorageService.pruneExpiredScheduledTasks();
        await StorageService.pruneHistoryTasks();
        return;
      }

      // Atomically move the task from scheduled queue into 24h history
      const task = await StorageService.moveScheduledTaskToHistory(alarm.name);
      if (!task) {
        return;
      }

      // Execute search queries immediately in new tabs
      await executeQueries(task.queries, task.engine);

      // Display informative desktop notification
      const queryCount = task.queries ? task.queries.length : 0;
      const engineLabel = task.engine === 'youtube' ? 'YouTube' : 'Google';
      const queryPreview = (task.queries || []).slice(0, 3).join(', ') + (queryCount > 3 ? ` (+${queryCount - 3} more)` : '');
      const notifId = `rabbit_hole_executed_${alarm.name}_${Date.now()}`;
      const iconPath = chrome.runtime.getURL ? chrome.runtime.getURL('icons/icon48.png') : 'icons/icon48.png';

      if (chrome.notifications && chrome.notifications.create) {
        chrome.notifications.create(notifId, {
          type: 'basic',
          iconUrl: iconPath,
          title: `rabbit-hole: ${queryCount} ${engineLabel} ${queryCount === 1 ? 'Query' : 'Queries'} Opened`,
          message: queryPreview || 'Opened in new tabs',
          priority: 1
        });
      }
    } catch (error) {
      console.error('[rabbit-hole] Error handling alarm execution:', error);
    }
  });

  // Restore device-local alarms after service-worker restarts and import tasks
  // created before sync support was introduced.
  (async () => {
    await StorageService.migrateScheduledTasksToSync();
    await StorageService.pruneExpiredScheduledTasks();
    await StorageService.restoreScheduledAlarms();
    await StorageService.pruneHistoryTasks();
  })().catch((error) => {
    console.error('[rabbit-hole] Error restoring synced tasks:', error);
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes[StorageService.STORAGE_KEYS.SCHEDULED_TASKS]) {
        StorageService.restoreScheduledAlarms().catch((error) => {
          console.error('[rabbit-hole] Error applying synced task changes:', error);
        });
      }
    });
  }
}

/**
 * Dismiss desktop notification on click
 */
if (typeof chrome !== 'undefined' && chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(async (notifId) => {
    try {
      await chrome.notifications.clear(notifId);
    } catch (e) {}
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getSearchUrl,
    executeQueries
  };
}
