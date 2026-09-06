/**
 * rabbit-hole - Background Service Worker
 */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    const data = await chrome.storage.local.get('scheduled_tasks');
    const tasks = data.scheduled_tasks || [];

    // Find the task matching the alarm name
    const taskIndex = tasks.findIndex((t) => t.id === alarm.name);

    if (taskIndex === -1) {
      console.warn(`[rabbit-hole] No matching task found for alarm: ${alarm.name}`);
      return;
    }

    const task = tasks[taskIndex];

    // Open each query in a new Google search tab
    if (Array.isArray(task.queries)) {
      for (const query of task.queries) {
        if (query && query.trim()) {
          const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query.trim());
          await chrome.tabs.create({ url: searchUrl });
        }
      }
    }

    // Remove executed task from scheduled_tasks to prevent duplicate runs
    tasks.splice(taskIndex, 1);
    await chrome.storage.local.set({ scheduled_tasks: tasks });

    console.log(`[rabbit-hole] Successfully executed and cleared task: ${alarm.name}`);
  } catch (error) {
    console.error('[rabbit-hole] Error handling alarm execution:', error);
  }
});

