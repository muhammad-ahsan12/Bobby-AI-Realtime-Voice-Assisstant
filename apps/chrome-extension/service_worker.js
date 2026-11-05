const BRIDGE_URL = "ws://127.0.0.1:8765/browser";
const ALL_SITES = ["<all_urls>"];
let socket;
let reconnectDelay = 1000;
let reconnectTimer;
let keepaliveTimer;

function connectBridge() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(BRIDGE_URL);
  socket.addEventListener("open", () => {
    reconnectDelay = 1000;
    socket.send(JSON.stringify({ type: "hello", version: 1 }));
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);
  });
  socket.addEventListener("message", (event) => {
    void handleBridgeRequest(event.data);
  });
  socket.addEventListener("close", () => {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = undefined;
    scheduleReconnect();
  });
  socket.addEventListener("error", () => socket.close());
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectBridge();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

async function getAuthorizedIds() {
  const saved = await chrome.storage.local.get({ authorizedTabs: [] });
  return new Set(saved.authorizedTabs.filter(Number.isInteger));
}

async function hasWholeChromeAccess() {
  const saved = await chrome.storage.local.get({ wholeChromeAccess: false });
  return saved.wholeChromeAccess === true;
}

async function saveAuthorizedIds(ids) {
  await chrome.storage.local.set({ authorizedTabs: [...ids] });
}

async function authorizeCreatedTab(tabId) {
  if (await hasWholeChromeAccess()) return;
  const ids = await getAuthorizedIds();
  ids.add(tabId);
  await saveAuthorizedIds(ids);
}

function parseWebUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only http and https URLs without embedded credentials are supported.");
  }
  return url;
}

function waitForTabComplete(tabId, timeoutMs = 15000, matches = () => true) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const finish = (callback, value) => {
      cleanup();
      callback(value);
    };
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete" && matches(tab)) {
        finish(resolve, tab);
      }
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        finish(reject, new Error("The tab was closed before navigation completed."));
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    timer = setTimeout(
      () => finish(reject, new Error("Chrome navigation timed out.")),
      timeoutMs
    );
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete" && matches(tab)) finish(resolve, tab);
    }, (error) => finish(reject, error));
  });
}

function waitForTabUrlChange(tabId, previousUrl, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const finish = (callback, value) => {
      cleanup();
      callback(value);
    };
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.url && changeInfo.url !== previousUrl) {
        finish(resolve, tab);
      }
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        finish(reject, new Error("The tab was closed before navigating back."));
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    timer = setTimeout(
      () => finish(reject, new Error("Chrome did not navigate to a previous page.")),
      timeoutMs
    );
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.url && tab.url !== previousUrl) finish(resolve, tab);
    }, (error) => finish(reject, error));
  });
}

function reloadAndWait(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const finish = (callback, value) => {
      cleanup();
      callback(value);
    };
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "loading") sawLoading = true;
      if (sawLoading && changeInfo.status === "complete") finish(resolve, tab);
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        finish(reject, new Error("The tab was closed before refresh completed."));
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    timer = setTimeout(
      () => finish(reject, new Error("Chrome refresh timed out.")),
      timeoutMs
    );
    void chrome.tabs.reload(tabId).catch((error) => finish(reject, error));
  });
}

async function requireAuthorizedTab(tabId) {
  if (await hasWholeChromeAccess()) {
    if (Number.isInteger(tabId)) {
      const tab = await chrome.tabs.get(tabId);
      if (!Number.isInteger(tab.id)) throw new Error("Chrome returned an invalid tab ID.");
      return tab;
    }
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !Number.isInteger(activeTab.id)) {
      throw new Error("Chrome has no active tab to control.");
    }
    return activeTab;
  }

  const ids = await getAuthorizedIds();
  let tab;
  if (Number.isInteger(tabId)) {
    if (!ids.has(tabId)) throw new Error("That tab has not been authorized in Bobby's extension.");
    tab = await chrome.tabs.get(tabId);
  } else {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTabs.find((candidate) => ids.has(candidate.id));
    if (!tab) {
      throw new Error("Grant Bobby access to all Chrome tabs in the extension popup.");
    }
  }
  if (!Number.isInteger(tab.id)) throw new Error("Chrome returned an invalid tab ID.");
  return tab;
}

async function requireSiteAccess(tab) {
  const hasAccess = await chrome.permissions.contains({ origins: ALL_SITES });
  if (!hasAccess) {
    throw new Error("Grant the extension all-sites access in its popup before reading or controlling pages.");
  }
  const url = new URL(tab.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Chrome does not allow page automation on this browser page.");
  }
}

async function executeInPage(tab, action, params = {}) {
  await requireSiteAccess(tab);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["page_script.js"]
  });
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "bobby-page-action",
    action,
    params
  });
  if (!response || response.error) throw new Error(response?.error || "Chrome returned no page result.");
  return response.result;
}

async function handleAction(action, params) {
  switch (action) {
    case "tabs.list": {
      const ids = await getAuthorizedIds();
      const tabs = await chrome.tabs.query({});
      const wholeChromeAccess = await hasWholeChromeAccess();
      return tabs.filter((tab) => wholeChromeAccess || ids.has(tab.id)).map((tab) => {
        const url = tab.url ? new URL(tab.url) : undefined;
        return {
          id: tab.id,
          title: tab.title || "",
          url: url ? `${url.origin}${url.pathname}` : "",
          active: Boolean(tab.active)
        };
      });
    }
    case "tabs.activate": {
      const tab = await requireAuthorizedTab(params.tabId);
      await chrome.tabs.update(tab.id, { active: true });
      return { id: tab.id, title: tab.title || "", active: true };
    }
    case "tabs.new": {
      const url = parseWebUrl(params.url);
      const tab = await chrome.tabs.create({ url: url.href, active: true });
      if (!Number.isInteger(tab.id)) throw new Error("Chrome returned an invalid new tab ID.");
      await authorizeCreatedTab(tab.id);
      const loadedTab = await waitForTabComplete(tab.id);
      return {
        id: tab.id,
        title: loadedTab.title || "",
        url: `${url.origin}${url.pathname}`,
        authorized: true,
        message: "Opened in a new tab."
      };
    }
    case "tabs.close": {
      const tab = await requireAuthorizedTab(params.tabId);
      const ids = await getAuthorizedIds();
      ids.delete(tab.id);
      await saveAuthorizedIds(ids);
      await chrome.tabs.remove(tab.id);
      return { id: tab.id, closed: true };
    }
    case "page.navigate": {
      const tab = await requireAuthorizedTab(params.tabId);
      const url = parseWebUrl(params.url);
      const updatedTab = await chrome.tabs.update(tab.id, { url: url.href, active: true });
      if (!Number.isInteger(updatedTab.id)) throw new Error("Chrome returned an invalid tab ID.");
      await waitForTabComplete(updatedTab.id);
      return { id: updatedTab.id, url: `${url.origin}${url.pathname}`, navigated: true };
    }
    case "youtube.search_play": {
      const query = String(params.query || "").trim();
      if (!query || query.length > 300) throw new Error("Provide a YouTube search under 300 characters.");
      const searchUrl = parseWebUrl(params.searchUrl);
      if (
        searchUrl.hostname !== "www.youtube.com" ||
        searchUrl.pathname !== "/results" ||
        !searchUrl.searchParams.get("search_query")
      ) {
        throw new Error("The generated YouTube search URL is invalid.");
      }
      const tab = await chrome.tabs.create({ url: searchUrl.href, active: true });
      if (!Number.isInteger(tab.id)) throw new Error("Chrome returned an invalid new tab ID.");
      await authorizeCreatedTab(tab.id);
      await waitForTabComplete(tab.id);
      const selected = await executeInPage(tab, "youtube.find_first_video");
      if (!selected || typeof selected.videoUrl !== "string") {
        throw new Error("YouTube returned an invalid video result.");
      }
      const selectedUrl = parseWebUrl(selected.videoUrl);
      const videoId = selectedUrl.searchParams.get("v") || "";
      if (
        !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(selectedUrl.hostname) ||
        selectedUrl.pathname !== "/watch" ||
        !/^[\w-]{11}$/.test(videoId)
      ) {
        throw new Error("YouTube returned a result without a valid video ID.");
      }
      const videoUrl = new URL("https://www.youtube.com/watch");
      videoUrl.searchParams.set("v", videoId);
      videoUrl.searchParams.set("autoplay", "1");
      const watchTab = await chrome.tabs.update(tab.id, { url: videoUrl.href, active: true });
      if (!Number.isInteger(watchTab.id)) throw new Error("Chrome returned an invalid video tab ID.");
      const loadedWatchTab = await waitForTabComplete(watchTab.id, 15000, (candidate) => {
        try {
          const candidateUrl = new URL(candidate.url);
          return candidateUrl.hostname === "www.youtube.com" &&
            candidateUrl.pathname === "/watch" &&
            candidateUrl.searchParams.get("v") === videoId;
        } catch {
          return false;
        }
      });
      const playback = await executeInPage(loadedWatchTab, "youtube.start_playback");
      const message = !playback.playbackStarted
        ? playback.playbackError?.startsWith("NotAllowedError")
          ? "Opened the video, but Chrome blocked automatic playback. Click YouTube's Play button once; extension tab access does not bypass browser autoplay rules."
          : `Opened the video, but playback did not start${playback.playbackError ? `: ${playback.playbackError}` : "."}`
        : playback.adShowing && !playback.skippedAd
          ? "Playback is running, but YouTube still has an ad playing and no Skip ad button is available yet."
          : playback.skippedAd
            ? "Opened and started the video in a new tab; clicked YouTube's visible Skip ad button."
            : "Opened and started the video in a new tab.";
      return {
        id: loadedWatchTab.id,
        title: loadedWatchTab.title || selected.title || "",
        url: videoUrl.origin + videoUrl.pathname + videoUrl.search,
        openedInNewTab: true,
        selected,
        playback,
        message
      };
    }
    case "page.back": {
      const tab = await requireAuthorizedTab(params.tabId);
      if (!tab.url) throw new Error("Chrome did not provide the current tab URL.");
      const previousTabUrl = tab.url;
      await executeInPage(tab, "page.back");
      const previousTab = await waitForTabUrlChange(tab.id, previousTabUrl);
      return { id: tab.id, url: new URL(previousTab.url).origin + new URL(previousTab.url).pathname };
    }
    case "page.reload": {
      const tab = await requireAuthorizedTab(params.tabId);
      await reloadAndWait(tab.id);
      return { id: tab.id, reloaded: true };
    }
    case "page.snapshot": {
      const tab = await requireAuthorizedTab(params.tabId);
      return executeInPage(tab, "page.snapshot");
    }
    case "page.click": {
      const tab = await requireAuthorizedTab(params.tabId);
      return executeInPage(tab, "page.click", { ref: params.ref });
    }
    case "page.type": {
      const tab = await requireAuthorizedTab(params.tabId);
      return executeInPage(tab, "page.type", { ref: params.ref, text: params.text });
    }
    case "page.key": {
      const tab = await requireAuthorizedTab(params.tabId);
      return executeInPage(tab, "page.key", { key: params.key, ref: params.ref });
    }
    case "page.scroll": {
      const tab = await requireAuthorizedTab(params.tabId);
      return executeInPage(tab, "page.scroll", {
        direction: params.direction,
        amount: params.amount
      });
    }
    case "media.control": {
      const tab = await requireAuthorizedTab(params.tabId);
      if (params.action === "skip_ad") {
        return executeInPage(tab, "media.skip_ad");
      }
      return executeInPage(tab, "media.control", {
        action: params.action,
        volume: params.volume
      });
    }
    default:
      throw new Error("Unsupported browser action.");
  }
}

async function handleBridgeRequest(rawMessage) {
  let request;
  try {
    request = JSON.parse(rawMessage);
    if (request.type !== "request" || typeof request.id !== "string" ||
        typeof request.action !== "string" || !request.params || typeof request.params !== "object") {
      return;
    }
    const result = await handleAction(request.action, request.params);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "response", id: request.id, result }));
    }
  } catch (error) {
    if (request && typeof request.id === "string" && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "response",
        id: request.id,
        error: error instanceof Error ? error.message : "The Chrome action failed."
      }));
    }
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void getAuthorizedIds().then((ids) => {
    if (!ids.delete(tabId)) return;
    return saveAuthorizedIds(ids);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "popup-state") {
    void (async () => {
      const ids = await getAuthorizedIds();
      const tabs = await chrome.tabs.query({});
      const siteAccess = await chrome.permissions.contains({ origins: ALL_SITES });
      const wholeChromeAccess = await hasWholeChromeAccess();
      return {
        connected: socket?.readyState === WebSocket.OPEN,
        siteAccess,
        wholeChromeAccess,
        tabs: tabs.filter((tab) => wholeChromeAccess || ids.has(tab.id)).map((tab) => ({
          id: tab.id,
          title: tab.title || "",
          active: Boolean(tab.active)
        }))
      };
    })().then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message.type === "authorize-active-tab") {
    void (async () => {
      if (!(await chrome.permissions.contains({ origins: ALL_SITES }))) {
        throw new Error("Grant all-sites permission first.");
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !Number.isInteger(tab.id) || !tab.url || !/^https?:/.test(tab.url)) {
        throw new Error("Select an http or https page to authorize.");
      }
      const ids = await getAuthorizedIds();
      ids.add(tab.id);
      await saveAuthorizedIds(ids);
      return { authorized: true, id: tab.id, title: tab.title || "" };
    })().then(sendResponse, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message.type === "grant-whole-chrome") {
    void chrome.permissions.contains({ origins: ALL_SITES }).then(async (siteAccess) => {
      if (!siteAccess) throw new Error("Grant all-sites access first.");
      await chrome.storage.local.set({ wholeChromeAccess: true });
      sendResponse({ granted: true });
    }, (error) => sendResponse({ error: error.message })).catch((error) => {
      sendResponse({ error: error.message });
    });
    return true;
  }
  if (message.type === "revoke-whole-chrome") {
    void chrome.storage.local.set({ wholeChromeAccess: false, authorizedTabs: [] }).then(() => {
      sendResponse({ revoked: true });
    }, (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message.type === "revoke-tab" && Number.isInteger(message.tabId)) {
    void getAuthorizedIds().then(async (ids) => {
      ids.delete(message.tabId);
      await saveAuthorizedIds(ids);
      sendResponse({ revoked: true });
    }, (error) => sendResponse({ error: error.message }));
    return true;
  }
});

connectBridge();
