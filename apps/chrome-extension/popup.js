const connection = document.querySelector("#connection");
const grantButton = document.querySelector("#grant");
const revokeAccessButton = document.querySelector("#revoke-access");
const grantChromeButton = document.querySelector("#grant-chrome");
const revokeChromeButton = document.querySelector("#revoke-chrome");
const tabsHeading = document.querySelector("#tabs-heading");
const tabsList = document.querySelector("#tabs");
const message = document.querySelector("#message");

async function send(type, extras = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extras });
  if (!response || response.error) throw new Error(response?.error || "No response from the extension.");
  return response;
}

async function refresh() {
  try {
    const state = await send("popup-state");
    connection.textContent = state.connected
      ? "Connected to the local Bobby agent."
      : "Waiting for Bobby. Start the agent and connect a voice session.";
    grantButton.disabled = state.siteAccess;
    grantButton.textContent = state.siteAccess ? "All-sites access granted" : "Grant all-sites access";
    revokeAccessButton.disabled = !state.siteAccess;
    grantChromeButton.disabled = state.wholeChromeAccess || !state.siteAccess;
    revokeChromeButton.disabled = !state.wholeChromeAccess;
    grantChromeButton.textContent = state.wholeChromeAccess
      ? "Bobby can access all Chrome tabs"
      : "Allow Bobby all Chrome tabs";
    tabsHeading.textContent = state.wholeChromeAccess
      ? "All current Chrome tabs"
      : "Authorized tabs";
    tabsList.replaceChildren();
    for (const tab of state.tabs) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${tab.active ? "Active: " : ""}${tab.title || `Tab ${tab.id}`}`;
      item.append(label);
      tabsList.append(item);
    }
  } catch (error) {
    connection.textContent = "Extension status unavailable.";
    message.textContent = error.message;
  }
}

grantButton.addEventListener("click", async () => {
  message.textContent = "";
  try {
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (!granted) throw new Error("Chrome did not grant all-sites permission.");
    message.textContent = "All-sites access granted.";
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  }
});

revokeAccessButton.addEventListener("click", async () => {
  message.textContent = "";
  try {
    const removed = await chrome.permissions.remove({ origins: ["<all_urls>"] });
    if (!removed) throw new Error("Chrome did not revoke all-sites permission.");
    await chrome.storage.local.set({ wholeChromeAccess: false, authorizedTabs: [] });
    message.textContent = "All-sites access revoked.";
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  }
});

grantChromeButton.addEventListener("click", async () => {
  message.textContent = "";
  try {
    await send("grant-whole-chrome");
    message.textContent = "Bobby now has access to all current and newly opened Chrome tabs.";
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  }
});

revokeChromeButton.addEventListener("click", async () => {
  message.textContent = "";
  try {
    await send("revoke-whole-chrome");
    message.textContent = "Bobby's access to Chrome tabs was revoked.";
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  }
});

void refresh();
