# rabbit-hole (Chrome Extension)

A lightweight Google Chrome / Chromium extension built with standard Manifest V3 and zero external dependencies. **rabbit-hole** allows you to schedule search queries to automatically open in individual Google Search tabs at your chosen date and time.

---

## Features

- **Single or Batch Scheduling**: Enter one or multiple queries (one per line) in a single task.
- **Native HTML5 Date & Time Picker**: Choose exact trigger times with native calendar and time controls.
- **Accurate Scheduling with Chrome Alarms**: Uses `chrome.alarms` to wake up the service worker and execute on time, even if the popup is closed.
- **Google Style Card UI**: Modern, clean design with elevation shadows, interactive query chips, and responsive feedback banners.
- **Task Management**: View pending tasks sorted chronologically with count badges, and easily cancel upcoming tasks.
- **Automatic Sync**: Real-time updates via `chrome.storage.onChanged` ensuring UI consistency.

---

## File Structure

```text
├── manifest.json   # Chrome MV3 manifest configuration
├── popup.html      # Extension popup UI structure
├── popup.css       # Clean Google Card elevation styling
├── popup.js        # Form validation, alarm registration, and task rendering
├── background.js   # Background service worker listening for alarms & opening tabs
└── README.md       # Documentation and setup instructions
```

---

## Installation Guide (Load Unpacked)

Follow these steps to load the extension into Google Chrome or any Chromium-based browser (Brave, Edge, Arc, Opera, etc.):

1. **Open the Extensions Page**:
   - In Chrome's address bar, navigate to `chrome://extensions` and press **Enter**.
2. **Enable Developer Mode**:
   - In the top-right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.
3. **Load the Unpacked Extension**:
   - Click the **Load unpacked** button in the top-left corner.
   - In the file dialog, navigate to and select this project directory:
     ```text
     /Users/channa/Projects/rabbit-hole
     ```
   - Click **Select** / **Open**.
4. **Pin for Easy Access**:
   - Click the puzzle-piece icon (Extensions) in the Chrome toolbar.
   - Find **rabbit-hole** and click the pin icon to keep it visible in your toolbar.

---

## How to Use

1. **Open the Extension**:
   - Click the **rabbit-hole** icon in your browser toolbar.
2. **Enter Search Queries**:
   - In the **Search Queries** text area, type or paste the queries you want to search. Put each query on its own line:
     ```text
     openai o3 benchmarks
     local weather this weekend
     healthy quick dinner recipes
     ```
3. **Select Date & Time**:
   - Choose when you want the queries to open using the **Trigger Date & Time** picker (defaults to 10 minutes from current time).
4. **Schedule**:
   - Click **Schedule Queries**.
   - You will see a success confirmation banner, and your task will appear in the **Scheduled Tasks** list below.
5. **Automated Search Execution**:
   - When the scheduled time arrives, the background service worker automatically creates a new tab for each search query:
     ```text
     https://www.google.com/search?q=<query>
     ```
   - The completed task is automatically cleared from your queue.
6. **Canceling a Task**:
   - If you want to cancel any upcoming task before it runs, simply click the **Cancel** button on that task's card.

