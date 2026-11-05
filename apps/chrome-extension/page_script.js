if (!globalThis.__bobbyPageScriptInstalled) {
  globalThis.__bobbyPageScriptInstalled = true;

  const MAX_PAGE_TEXT = 12000;
  const MAX_ELEMENTS = 100;
  const INTERACTIVE_SELECTOR = [
    "a[href]", "button", "input:not([type=hidden])", "textarea", "select",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]",
    "[role=tab]", "[contenteditable=true]"
  ].join(",");

  function visibleElements() {
    return [...document.querySelectorAll(INTERACTIVE_SELECTOR)].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" &&
        Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 &&
        !element.disabled;
    }).slice(0, MAX_ELEMENTS);
  }

  function pageSnapshot() {
    const elements = visibleElements().map((element, index) => ({
      ref: index + 1,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      text: (element.innerText || element.textContent || "").trim().slice(0, 180),
      label: element.getAttribute("aria-label") || element.getAttribute("title") || "",
      placeholder: element.getAttribute("placeholder") || "",
      type: element instanceof HTMLInputElement ? element.type : ""
    }));
    const pageUrl = new URL(location.href);
    return {
      title: document.title,
      url: `${pageUrl.origin}${pageUrl.pathname}`,
      text: (document.body?.innerText || "").slice(0, MAX_PAGE_TEXT),
      elements
    };
  }

  function requireElement(ref) {
    if (!Number.isInteger(ref) || ref < 1) {
      throw new Error("Use a positive element reference from the latest page snapshot.");
    }
    const element = visibleElements()[ref - 1];
    if (!element) {
      throw new Error("That page element reference is no longer available; read the page again.");
    }
    return element;
  }

  async function performPageAction(action, params) {
    switch (action) {
      case "page.snapshot":
        return pageSnapshot();
      case "youtube.find_first_video": {
        if (location.hostname !== "www.youtube.com" || location.pathname !== "/results") {
          throw new Error("Open YouTube search results before asking Bobby to play a video.");
        }
        const findVideoLink = () => [...document.querySelectorAll("a#video-title[href]")].find((link) => {
          const url = new URL(link.href, location.href);
          const rect = link.getBoundingClientRect();
          const videoId = url.searchParams.get("v") || "";
          const isAd = Boolean(link.closest(
            "ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer," +
            "ytd-promoted-sparkles-text-search-renderer,[data-ad-slot]"
          ));
          return ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) &&
            url.pathname === "/watch" && /^[\w-]{11}$/.test(videoId) &&
            Boolean((link.getAttribute("title") || link.innerText || "").trim()) &&
            rect.width > 0 && rect.height > 0 && !isAd;
        });
        const resultsDeadline = Date.now() + 10000;
        let videoLink = findVideoLink();
        while (!videoLink && Date.now() < resultsDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          videoLink = findVideoLink();
        }
        if (!videoLink) throw new Error("YouTube did not show a playable video result.");
        const video = new URL(videoLink.href, location.href);
        const title = (videoLink.getAttribute("title") || videoLink.innerText || "").trim();
        return {
          title,
          videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(video.searchParams.get("v"))}`
        };
      }
      case "youtube.start_playback": {
        if (location.hostname !== "www.youtube.com" || location.pathname !== "/watch") {
          throw new Error("The new tab did not open a YouTube video page.");
        }

        const isVisible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" &&
            Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
        };
        const findSkipButton = () => [...document.querySelectorAll(
          ".ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,button,[role=button]"
        )].find((element) => {
          const label = [
            element.innerText,
            element.getAttribute("aria-label"),
            element.getAttribute("title")
          ].filter(Boolean).join(" ").trim();
          return isVisible(element) && !element.disabled &&
            /^skip\s+(the\s+)?ads?\b/i.test(label);
        });
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let player = document.querySelector("video");
        const playerDeadline = Date.now() + 5000;
        while (!player && Date.now() < playerDeadline) {
          await wait(200);
          player = document.querySelector("video");
        }
        if (!player) throw new Error("YouTube loaded, but no video player is available.");

        let playError = "";
        try {
          await player.play();
        } catch (error) {
          playError = error instanceof Error
            ? `${error.name}: ${error.message}`
            : "The browser blocked autoplay.";
        }

        if (player.paused) {
          const playButton = document.querySelector(".ytp-large-play-button");
          if (isVisible(playButton)) {
            playButton.click();
            await wait(400);
            player = document.querySelector("video") || player;
            if (player.paused) {
              try {
                await player.play();
                playError = "";
              } catch (error) {
                playError = error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : "The browser blocked autoplay.";
              }
            }
          }
        }

        let skippedAd = false;
        const adDeadline = Date.now() + 7000;
        while (document.querySelector(".ad-showing") && Date.now() < adDeadline) {
          const skipButton = findSkipButton();
          if (skipButton) {
            skipButton.click();
            skippedAd = true;
            await wait(500);
            break;
          }
          await wait(250);
        }

        player = document.querySelector("video") || player;
        if (player.paused) {
          try {
            await player.play();
            playError = "";
          } catch (error) {
            playError = error instanceof Error
              ? `${error.name}: ${error.message}`
              : "The browser blocked autoplay.";
          }
        }
        await wait(800);
        player = document.querySelector("video") || player;
        const playbackStarted = !player.paused && !player.ended;
        const adShowing = Boolean(document.querySelector(".ad-showing"));
        return {
          playbackStarted,
          paused: player.paused,
          currentTime: player.currentTime,
          adShowing,
          skippedAd,
          ...(playError && !playbackStarted ? { playbackError: playError } : {})
        };
      }
      case "page.back":
        history.back();
        return { navigation: "back requested" };
      case "page.click": {
        const element = requireElement(params.ref);
        element.click();
        return {
          clicked: true,
          tag: element.tagName.toLowerCase(),
          text: (element.innerText || "").trim().slice(0, 180)
        };
      }
      case "page.type": {
        const element = requireElement(params.ref);
        if (element instanceof HTMLInputElement && ["password", "hidden"].includes(element.type)) {
          throw new Error("Typing into password or hidden fields is not allowed.");
        }
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
          throw new Error("The referenced element is not an editable text field.");
        }
        element.focus();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, params.text);
        } else {
          element.textContent = params.text;
        }
        element.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: params.text
        }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { typed: true, tag: element.tagName.toLowerCase(), characters: params.text.length };
      }
      case "page.key": {
        if (params.key !== "Enter") throw new Error("Only Enter is supported.");
        const element = Number.isInteger(params.ref) ? requireElement(params.ref) : document.activeElement;
        if (!(element instanceof HTMLElement)) throw new Error("No focused element is available.");
        element.focus();
        const form = element.closest("form");
        if (form) {
          form.requestSubmit();
          return { key: params.key, submitted: true };
        }
        if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) {
          element.click();
          return { key: params.key, activated: true };
        }
        return { key: params.key, submitted: false };
      }
      case "page.scroll": {
        if (!["up", "down"].includes(params.direction) ||
            !Number.isInteger(params.amount) || params.amount < 100 || params.amount > 2000) {
          throw new Error("Invalid scroll direction or distance.");
        }
        window.scrollBy({
          top: params.direction === "down" ? params.amount : -params.amount,
          behavior: "smooth"
        });
        return { direction: params.direction, amount: params.amount, scrollY: window.scrollY };
      }
      case "media.skip_ad": {
        const skipButton = [...document.querySelectorAll(
          "button,[role=button],.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button"
        )]
          .find((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const label = [
              element.innerText,
              element.getAttribute("aria-label"),
              element.getAttribute("title")
            ].filter(Boolean).join(" ").trim();
            return style.visibility !== "hidden" && style.display !== "none" &&
              Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 &&
              !element.disabled && /^skip\s+(the\s+)?ads?\b/i.test(label);
          });
        if (!skipButton) {
          throw new Error("No visible Skip ad button is available. Bobby does not block or bypass ads.");
        }
        const label = (skipButton.innerText || skipButton.getAttribute("aria-label") || "Skip ad")
          .trim().slice(0, 100);
        skipButton.click();
        return { clicked: true, label };
      }
      case "media.control": {
        const players = [...document.querySelectorAll("video,audio")];
        const player = players.find((candidate) => !candidate.paused) || players[0];
        if (!player) throw new Error("No media player is available on this page.");
        switch (params.action) {
          case "play": await player.play(); break;
          case "pause": player.pause(); break;
          case "mute": player.muted = true; break;
          case "unmute": player.muted = false; break;
          case "volume":
            if (typeof params.volume !== "number" || params.volume < 0 || params.volume > 1) {
              throw new Error("Volume must be from 0.0 to 1.0.");
            }
            player.volume = params.volume;
            break;
          case "skip_forward":
            player.currentTime = Math.min(player.duration || Infinity, player.currentTime + 10);
            break;
          case "skip_back":
            player.currentTime = Math.max(0, player.currentTime - 10);
            break;
          default:
            throw new Error("Unsupported media action.");
        }
        return {
          paused: player.paused,
          muted: player.muted,
          volume: player.volume,
          currentTime: player.currentTime
        };
      }
      default:
        throw new Error("Unsupported page action.");
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "bobby-page-action") return;
    void performPageAction(message.action, message.params || {}).then(
      (result) => sendResponse({ result }),
      (error) => sendResponse({ error: error instanceof Error ? error.message : "Page action failed." })
    );
    return true;
  });
}
