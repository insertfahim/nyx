// Utility functions
const formatTime = (ms) => {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const formatTimeRemaining = (ms) => {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
};

// UI update functions
const updateBlockedList = async () => {
  const blockedList = document.getElementById("blocked-list");

  try {
    const response = await chrome.runtime.sendMessage({
      action: "getBlockedWebsites",
    });
    const blockedWebsites = response.blockedWebsites || [];

    blockedList.innerHTML = "";

    if (blockedWebsites.length === 0) {
      blockedList.innerHTML =
        '<p class="no-data">No websites are currently blocked.</p>';
      return;
    }

    const now = Date.now();
    const activeBlocks = blockedWebsites
      .filter((site) => site.finishTime > now)
      .sort((a, b) => a.finishTime - b.finishTime);

    if (activeBlocks.length === 0) {
      blockedList.innerHTML =
        '<p class="no-data">No websites are currently blocked.</p>';
      return;
    }

    activeBlocks.forEach((site) => {
      const li = document.createElement("li");
      li.className = "blocked-item";

      const timeRemaining = site.finishTime - now;
      li.innerHTML = `
        <div class="website-info">
          <span class="website-name">${site.url}</span>
          <span class="finish-time" data-finish-time="${site.finishTime}">
            ${formatTimeRemaining(timeRemaining)}
          </span>
          <button class="unblock-btn" data-website="${
            site.url
          }">Unblock</button>
        </div>
      `;

      const unblockBtn = li.querySelector(".unblock-btn");
      unblockBtn.addEventListener("click", async () => {
        try {
          const response = await chrome.runtime.sendMessage({
            action: "unblockWebsite",
            website: site.url,
          });

          if (response.success) {
            updateBlockedList();
          } else {
            throw new Error(response.error);
          }
        } catch (error) {
          console.error("Error unblocking website:", error);
          alert("Failed to unblock website. Please try again.");
        }
      });

      blockedList.appendChild(li);
    });
  } catch (error) {
    console.error("Error updating blocked list:", error);
    blockedList.innerHTML =
      '<p class="error">Error loading blocked websites.</p>';
  }
};

// Add a debounce function to prevent frequent updates
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Cache the previous screen time data to prevent unnecessary updates
let previousScreenTime = null;

const updateScreenTime = async () => {
  const screenTimeList = document.getElementById("screentime-list");

  try {
    const response = await chrome.runtime.sendMessage({
      action: "getScreenTime",
    });
    const screenTime = response.screenTime || {};

    // Convert to string for comparison
    const currentDataString = JSON.stringify(screenTime);

    // Only update if data has changed
    if (previousScreenTime === currentDataString) {
      return;
    }

    previousScreenTime = currentDataString;

    // Sort websites by time spent (descending) and filter out less than 1 minute
    const sortedWebsites = Object.entries(screenTime)
      .filter(([_, data]) => data.timeSpent >= 60000) // 60000ms = 1 minute
      .sort(([_, a], [__, b]) => b.timeSpent - a.timeSpent);

    // Create new HTML content
    let newContent = "";

    if (sortedWebsites.length === 0) {
      newContent = `
        <div class="no-data">
          <span class="material-icons-round">timer_off</span>
          <p>No significant screen time recorded today</p>
        </div>`;
    } else {
      // Find the maximum time for percentage calculation
      const maxTime = Math.max(
        ...sortedWebsites.map(([_, data]) => data.timeSpent)
      );

      newContent = sortedWebsites
        .map(([domain, data]) => {
          const percentage = (data.timeSpent / maxTime) * 100;
          return `
          <div class="screentime-item">
            <div class="website-info">
              <span class="website-name">${domain}</span>
              <span class="time-spent">${formatTime(data.timeSpent)}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
          </div>
        `;
        })
        .join("");
    }

    // Only update DOM if content has changed
    if (screenTimeList.innerHTML !== newContent) {
      screenTimeList.innerHTML = newContent;
    }
  } catch (error) {
    console.error("Error updating screen time:", error);
    screenTimeList.innerHTML = `
      <div class="error">
        <span class="material-icons-round">error_outline</span>
        <p>Error loading screen time data</p>
      </div>`;
  }
};

// Use debounced version for the interval
const debouncedUpdate = debounce(updateScreenTime, 1000);

// Function to update countdown timers
const updateCountdowns = () => {
  const timeElements = document.querySelectorAll(".finish-time");
  const now = Date.now();

  timeElements.forEach((element) => {
    const finishTime = parseInt(element.dataset.finishTime);
    const timeRemaining = finishTime - now;

    if (timeRemaining <= 0) {
      updateBlockedList(); // Refresh the entire list if any timer expires
    } else {
      element.textContent = formatTimeRemaining(timeRemaining);
    }
  });
};

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  const blockForm = document.getElementById("block-form");
  const websiteInput = document.getElementById("website");
  const hoursInput = document.getElementById("hours");
  const minutesInput = document.getElementById("minutes");

  // Load initial data
  updateBlockedList();
  updateScreenTime();

  // Update countdowns every second
  const countdownInterval = setInterval(updateCountdowns, 1000);

  // Clear interval when popup closes
  window.addEventListener("unload", () => {
    clearInterval(countdownInterval);
  });

  // Set up form submission
  blockForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const website = websiteInput.value.trim();
    const hours = parseInt(hoursInput.value || "0", 10);
    const minutes = parseInt(minutesInput.value || "0", 10);

    if (!website) {
      alert("Please enter a website URL");
      websiteInput.focus();
      return;
    }

    if (hours === 0 && minutes === 0) {
      alert("Please set a block duration");
      hoursInput.focus();
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: "blockWebsite",
        website,
        duration: hours * 60 + minutes,
      });

      if (response.success) {
        blockForm.reset();
        websiteInput.focus();
        updateBlockedList();
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error("Error blocking website:", error);
      alert(error.message || "Failed to block website. Please try again.");
    }
  });

  // Set up tab switching
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(`${btn.dataset.tab}-tab`).classList.add("active");

      if (btn.dataset.tab === "screentime") {
        updateScreenTime();
      } else {
        updateBlockedList();
      }
    });
  });

  // Initial update
  updateScreenTime();

  // Use debounced version for periodic updates
  setInterval(debouncedUpdate, 1000);

  // Add ripple effect to all buttons
  const buttons = document.getElementsByTagName("button");
  for (const button of buttons) {
    button.addEventListener("click", createRipple);
  }
});

// Add this to your existing JavaScript
function createRipple(event) {
  const button = event.currentTarget;

  const circle = document.createElement("span");
  const diameter = Math.max(button.clientWidth, button.clientHeight);
  const radius = diameter / 2;

  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${event.clientX - button.offsetLeft - radius}px`;
  circle.style.top = `${event.clientY - button.offsetTop - radius}px`;
  circle.classList.add("ripple");

  const ripple = button.getElementsByClassName("ripple")[0];

  if (ripple) {
    ripple.remove();
  }

  button.appendChild(circle);
}
