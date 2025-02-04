// State management
let state = {
  blockedWebsites: [],
  screenTime: {},
  activeTab: {
    id: null,
    url: null,
    lastUpdate: Date.now(),
  },
};

// Helper functions
const getStartOfDay = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const getDomain = (url) => {
  try {
    if (!url || url.startsWith("chrome-extension://")) return null;
    const domain = new URL(url).hostname;
    return domain && !domain.includes("chrome-extension") ? domain : null;
  } catch (e) {
    return null;
  }
};

const validateUrl = (url) => {
  try {
    url = url.replace(/^(https?:\/\/)?(www\.)?/, "").split(/[/?#]/)[0];
    if (!url || url.length < 3 || !url.includes(".")) {
      throw new Error("Invalid URL format");
    }
    return url.toLowerCase();
  } catch (error) {
    throw new Error("Invalid URL format");
  }
};

// Website blocking functions
const updateBlockingRules = async () => {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const rulesToRemove = existingRules.map((rule) => rule.id);

    const rulesToAdd = state.blockedWebsites.flatMap((site, index) => {
      const patterns = [`*://${site.url}/*`, `*://www.${site.url}/*`];
      return patterns.map((pattern, i) => ({
        id: index * 2 + i + 1,
        priority: 1,
        action: { type: "block" },
        condition: {
          urlFilter: pattern,
          resourceTypes: ["main_frame", "sub_frame"],
        },
      }));
    });

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rulesToRemove,
      addRules: rulesToAdd,
    });
  } catch (error) {
    console.error("Error updating blocking rules:", error);
    throw error;
  }
};

const blockWebsite = async (website, duration) => {
  try {
    if (!website || !duration) {
      throw new Error("Website URL and duration are required");
    }

    const url = validateUrl(website);
    const now = Date.now();
    const finishTime = now + duration * 60 * 1000;

    // Check if already blocked
    if (
      state.blockedWebsites.some(
        (site) => site.url === url && site.finishTime > now
      )
    ) {
      throw new Error("Website is already blocked");
    }

    // Add to blocked list
    state.blockedWebsites.push({
      url,
      finishTime,
      blockedAt: now,
    });

    // Save state and update rules
    await chrome.storage.local.set({ blockedWebsites: state.blockedWebsites });
    await updateBlockingRules();
    await chrome.alarms.create(url, { when: finishTime });

    return true;
  } catch (error) {
    console.error("Error blocking website:", error);
    throw error;
  }
};

const unblockWebsite = async (website) => {
  try {
    const url = validateUrl(website);
    state.blockedWebsites = state.blockedWebsites.filter(
      (site) => site.url !== url
    );

    await chrome.storage.local.set({ blockedWebsites: state.blockedWebsites });
    await updateBlockingRules();
    await chrome.alarms.clear(url);

    return true;
  } catch (error) {
    console.error("Error unblocking website:", error);
    throw error;
  }
};

// Screen time tracking functions
const updateScreenTime = () => {
  if (!state.activeTab.url) return;

  const domain = getDomain(state.activeTab.url);
  if (!domain) return;

  const now = Date.now();
  const timeSpent = now - state.activeTab.lastUpdate;

  // Only update if time spent is reasonable (less than 1 minute)
  if (timeSpent > 0 && timeSpent < 60000) {
    if (!state.screenTime[domain]) {
      state.screenTime[domain] = { timeSpent: 0, lastUpdated: now };
    }

    // Reset if it's a new day
    if (state.screenTime[domain].lastUpdated < getStartOfDay()) {
      state.screenTime[domain].timeSpent = 0;
    }

    state.screenTime[domain].timeSpent += timeSpent;
    state.screenTime[domain].lastUpdated = now;

    chrome.storage.local.set({ screenTime: state.screenTime });
  }

  state.activeTab.lastUpdate = now;
};

// Initialize extension
const initializeExtension = async () => {
  try {
    // Load saved state
    const data = await chrome.storage.local.get([
      "blockedWebsites",
      "screenTime",
    ]);

    // Restore blocked websites
    state.blockedWebsites = (data.blockedWebsites || []).filter(
      (site) => site.finishTime > Date.now()
    );

    // Restore screen time
    state.screenTime = data.screenTime || {};

    // Clean up expired data
    const todayStart = getStartOfDay();
    Object.keys(state.screenTime).forEach((domain) => {
      if (state.screenTime[domain].lastUpdated < todayStart) {
        state.screenTime[domain].timeSpent = 0;
        state.screenTime[domain].lastUpdated = Date.now();
      }
    });

    // Save cleaned up state
    await chrome.storage.local.set({
      blockedWebsites: state.blockedWebsites,
      screenTime: state.screenTime,
    });

    // Update blocking rules
    await updateBlockingRules();
  } catch (error) {
    console.error("Error initializing extension:", error);
  }
};

// Event listeners
chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);

chrome.alarms.onAlarm.addListener((alarm) => {
  unblockWebsite(alarm.name);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  updateScreenTime();

  state.activeTab.id = activeInfo.tabId;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    state.activeTab.url = tab.url;
    state.activeTab.lastUpdate = Date.now();
  } catch (error) {
    console.error("Error getting tab:", error);
    state.activeTab.url = null;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === state.activeTab.id && changeInfo.url) {
    updateScreenTime();
    state.activeTab.url = changeInfo.url;
    state.activeTab.lastUpdate = Date.now();
  }
});

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);

  switch (message.action) {
    case "blockWebsite":
      blockWebsite(message.website, message.duration)
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({
            success: false,
            error: error.message,
          })
        );
      break;

    case "unblockWebsite":
      unblockWebsite(message.website)
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({
            success: false,
            error: error.message,
          })
        );
      break;

    case "getScreenTime":
      sendResponse({ screenTime: state.screenTime });
      break;

    case "getBlockedWebsites":
      sendResponse({ blockedWebsites: state.blockedWebsites });
      break;

    default:
      sendResponse({ success: false, error: "Unknown action" });
  }

  return true;
});

// Update screen time periodically
setInterval(updateScreenTime, 1000);
