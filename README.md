# rabbit-hole (Chrome Extension)

A lightweight, powerful Google Chrome / Chromium extension built with standard Manifest V3 and zero runtime external dependencies. **rabbit-hole** allows you to schedule search queries and web links to automatically open in individual tabs at specified dates and times.

Supports both **Google Search** and **YouTube Search**, intelligent prefix detection, synced schedules across Chrome devices, a 24-hour history with automatic expiration, ergonomic quick-time buttons, and desktop notifications.

---

## Key Features

### 🔍 Multi-Engine & Intelligent URL Routing
- **Google & YouTube Support**: Choose your default search engine with dedicated selector chips.
- **Engine Preference Persistence**: Remembers your preferred search engine selection across sessions.
- **Smart Prefix Overrides**:
  - Type `yt: <query>`, `youtube: <query>`, `yt <query>`, or `youtube <query>` to route searches to YouTube, even when Google is selected as the default engine.
  - Type `g: <query>`, `google: <query>`, `g <query>`, or `google <query>` to explicitly route to Google.
  - Type standalone `yt` or `youtube` to open YouTube home directly.
- **Direct URL & Domain Detection**: Automatically navigates full URLs (`https://`, `http://`) and bare domains/links (e.g. `youtube.com/watch?v=...`, `youtu.be/...`, `github.com`) directly without turning them into search queries.

### ⏱️ Quick Ergonomic Date & Time Controls
- **One-Click Day Shortcuts**:
  - **Today**: Aligns target time to today.
  - **Weekend**: Schedules for the upcoming Saturday morning (9:00 AM).
  - **+1 Day**: Advances the scheduled date by 24 hours.
- **Fast Time Increments**: Easily adjust trigger times with **-15m**, **+15m**, and **+1h** buttons.
- **Exact Minute Alignment**: Automatically snaps scheduled alarms to exact minute boundaries (`:00.000`) with a minimum 60-second future threshold, preventing late tab openings.
- **Live Preview Card**: Shows human-friendly formatted time (e.g. *"Today, 12:15 PM"*) along with real-time relative countdowns (*"in 15m"*).
- **Time Preference Memory**: Remembers your last scheduled time for faster repetitive scheduling.

### 📜 24-Hour Sliding History & Instant Rescheduling
- **Dual Tab Interface**: Toggle between active **Scheduled** tasks and past **History** tasks with dynamic badge counters.
- **History Cleanup**: Finished tasks expire automatically after 24 hours, can be cleared individually or in bulk, and can be rescheduled for +15m.
- **Multi-Device Schedules**: Scheduled tasks sync through Chrome Sync and run on every device that is active at the scheduled time; execution history stays local to each device.
- **Automatic 24h Pruning**: Automatically prunes executed queries older than 24 hours while preserving rescheduled items with future trigger times.
- **Engine Preservation**: Retains the original search engine (Google vs. YouTube) when rescheduling from history.

### 🛡️ Atomic Storage & Concurrency Architecture
- **Race-Condition Proof**: Persists scheduled task metadata to storage *before* registering alarms with `chrome.alarms`.
- **Promise-Based Mutex Lock (`storage.js`)**: Serializes storage operations via an internal queue (`withStorageLock`), guaranteeing atomic read-modify-write transactions during concurrent alarm fires or user interactions.
- **Multi-Task Synchronization**: Simultaneously firing alarms are cleared from the queue and migrated into history without tasks getting dropped or stuck.

### 🔔 Desktop Notifications
- Rich desktop notifications via `chrome.notifications` alert you when queries are executed.
- Displays query count, search engine label, and a preview of opened queries.
- Single-click notification dismissal.

---

## Project Structure

```text
├── manifest.json                  # Chrome Extension Manifest V3 configuration
├── popup.html                     # Popup interface with engine selector, inputs, and tabs
├── popup.css                      # Google Card-style design and typography
├── popup.js                       # Controller for form handling, time calculation, and tab rendering
├── storage.js                     # Shared storage module with atomic locks and task lifecycle management
├── background.js                  # Service worker handling chrome.alarms, tab creation, and notifications
├── icons/                         # Extension icons (16x16, 32x32 retina, 48x48, 128x128)
├── test/
│   └── storage_concurrency.test.js # Comprehensive test suite with mocked Chrome APIs
├── package.json                   # Project metadata and test scripts
└── README.md                      # Documentation
```

---

## Installation Guide (Load Unpacked)

Follow these steps to install or update the extension in Google Chrome, Brave, Edge, Arc, or any Chromium browser:

1. **Open the Extensions Manager**:
   - Navigate to `chrome://extensions` in the address bar.
2. **Enable Developer Mode**:
   - Toggle the **Developer mode** switch in the top-right corner to **ON**.
3. **Load the Unpacked Extension**:
   - Click the **Load unpacked** button in the top-left corner.
   - Select the project folder:
     ```text
     /Users/channa/Projects/rabbit-hole
     ```
   - Click **Select** / **Open**.
4. **Pin the Extension**:
   - Click the puzzle icon (Extensions) in your browser toolbar and pin **rabbit-hole** for quick access.

> [!TIP]
> **Updating the Extension**: When files on disk change (especially `background.js` or `storage.js`), navigate to `chrome://extensions` and click the **Reload** (circular arrow) icon on the rabbit-hole card to reload the background service worker into browser memory.

---

## Usage Guide

1. **Open Popup**: Click the **rabbit-hole** icon in your toolbar.
2. **Select Engine**: Click **Google** or **YouTube** (your choice is automatically saved for next time).
3. **Enter Queries**: Add one search query or URL per line. Examples:
   ```text
   react server components guide
   yt: lo-fi chill beats
   youtube space documentary
   https://github.com/trending
   youtube.com/watch?v=dQw4w9WgXcQ
   ```
4. **Adjust Trigger Time**: Use the Day (**Today**, **Weekend**, **+1 Day**) and Time (**-15m**, **+15m**, **+1h**) buttons to set your target schedule.
5. **Schedule**: Click **Schedule Queries**. Your task will appear in the **Scheduled** tab with query chips and engine badges (`[YT]` for YouTube).
6. **Execution**: When the alarm fires, queries open automatically in new tabs, task moves to the **History** tab, and a desktop notification is displayed.
7. **Clear History**: Switch to **History** to clear one finished task, or select several and clear them together.

---

## Automated Testing

The project includes an automated test suite utilizing Node.js's built-in test runner (`node:test`) and strict assertions (`node:assert/strict`).

Run the test suite:

```bash
npm test
```

Or run directly with Node:

```bash
node --test
```

### Test Coverage Highlights:
- **Search URL Routing**: Default Google routing, YouTube engine routing, case-insensitive prefixes (`yt:`, `youtube:`, `yt `, `youtube `, `g:`, `google:`), bare domain URLs, and direct protocol URLs.
- **Engine Resolution & Persistence**: Preference persistence across storage and smart engine detection for tasks and rescheduled items.
- **Atomic History Transitions**: Single-task and multi-task simultaneous alarm trigger transitions from `scheduled_tasks` to `history_tasks`.
- **Concurrency & Race Conditions**: Ensuring 0 remaining stuck tasks under simultaneous alarm execution.
- **Sliding History Window**: 24-hour expiration pruning and preservation of rescheduled items.
- **Task Cancellation**: Unlinking alarms and clearing storage atomically.

---

## License

MIT License. Built for seamless and distraction-free web research.
