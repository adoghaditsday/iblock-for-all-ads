(() => {
  const state = {
    mode: 'regular',
    blockedElements: 0,
    popupSuppressions: 0,
    videoAdAlreadyLogged: false,
    whitelist: [],
    isWhitelisted: false,
    knownVideoHost: /(^|\.)(youtube\.com|youtu\.be|twitch\.tv|player\.twitch\.tv)$/i.test(location.hostname)
  };

  const strictSelectors = [
    'iframe[src*="doubleclick"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="adservice"]',
    'iframe[id*="aswift"]',
    '[data-ad]',
    '[data-ad-client]',
    '[data-ad-slot]',
    '[data-ad-unit]',
    '[data-google-query-id]',
    '.ytp-ad-module',
    '.ytp-ad-image-overlay',
    '.ytp-ad-overlay-container',
    '.video-ads',
    '.ad-showing',
    '.player-ad-overlay',
    '.vast',
    '.vpaid'
  ];

  const popupTrapSelectors = [
    'a[onclick*="window.open"]',
    'a[href^="javascript:"]',
    '[onclick*="popunder"]',
    '[onclick*="popup"]',
    '[data-popunder]',
    '[data-popup]'
  ];

  init();

  async function init() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getState', hostname: location.hostname });
      state.mode = response?.mode === 'super' ? 'super' : 'regular';
      state.whitelist = Array.isArray(response?.whitelist) ? response.whitelist : [];
      state.isWhitelisted = hostMatchesWhitelist(location.hostname, state.whitelist);
    } catch {}

    if (state.isWhitelisted) {
      document.documentElement?.classList?.add('iblock-whitelisted');
      return;
    }

    installPopupGuard();
    hardenWindowOpen();
    runSweep(document.documentElement || document);
    observeDom();
    watchVideoSignals();
  }

  function hostMatchesWhitelist(host, whitelist) {
    const normalized = String(host || '').replace(/^www\./i, '').toLowerCase();
    return whitelist.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
  }

  function installPopupGuard() {
    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('a, button, [role="button"], div');
      if (!target) return;

      const onclickText = target.getAttribute?.('onclick') || '';
      const href = target.getAttribute?.('href') || '';
      const isTrap = popupTrapSelectors.some((selector) => target.matches?.(selector)) ||
        /window\.open|popup|popunder|tabunder|clickunder/i.test(onclickText) ||
        /popunder|popup/i.test(target.dataset?.popup || '') ||
        (/^javascript:/i.test(href) && /window\.open|popup|popunder/i.test(href));

      if (isTrap) {
        event.stopPropagation();
        event.preventDefault();
        bumpPopupSuppressions();
      }
    }, true);
  }

  function hardenWindowOpen() {
    const originalOpen = window.open;
    window.open = function (...args) {
      const url = String(args?.[0] || '');
      const suspicious = /pop|under|tab|click|ads?|promo|redirect/i.test(url);
      if (suspicious) {
        bumpPopupSuppressions();
        return null;
      }
      return originalOpen.apply(window, args);
    };
  }

  function observeDom() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          runSweep(node);
        }
        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          evaluateElement(mutation.target);
        }
      }
      detectVideoAds();
    });

    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'style', 'src', 'href', 'data-ad', 'onclick', 'aria-label']
    });
  }

  function runSweep(root) {
    if (!(root instanceof Element) && root !== document) return;
    strictSelectors.forEach((selector) => {
      const nodes = root.querySelectorAll ? root.querySelectorAll(selector) : [];
      nodes.forEach(evaluateElement);
    });

    if (root instanceof Element) evaluateElement(root);
    neutralizeFixedAds(root);
    detectVideoAds();
  }

  function evaluateElement(el) {
    if (!(el instanceof Element)) return;
    if (el.dataset.iblockProcessed === '1') return;
    if (isLikelyContentCard(el)) return;

    const text = `${el.id || ''} ${safeClassName(el)} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-testid') || ''}`.toLowerCase();
    const srcLike = `${el.getAttribute('src') || ''} ${el.getAttribute('href') || ''}`.toLowerCase();
    const style = window.getComputedStyle(el);

    const hasStrongAdSignal =
      el.matches('[data-ad], [data-ad-client], [data-ad-slot], [data-ad-unit], [data-google-query-id]') ||
      /(doubleclick|googlesyndication|adservice|adsystem|taboola|outbrain|popads|exoclick|adnxs|advertising)/i.test(srcLike) ||
      /(^|\b)(adservice|advertisement|sponsored|promoted|taboola|outbrain|vpaid|vast)(\b|$)/i.test(text);

    const hasWeakClassSignal = /(^|\s)(ad|ads|adbox|ad-container|ad_wrapper|ad-wrapper|sponsor|sponsored)(\s|$)/i.test(text);
    const iframeOrImage = /^(IFRAME|IMG)$/i.test(el.tagName);
    const fixedOverlay = style.position === 'fixed' && Number.parseInt(style.zIndex || '0', 10) >= 999;
    const adSized = (el.clientWidth >= 120 && el.clientHeight >= 50) || (el.clientWidth >= 250 && el.clientHeight >= 30);

    if (hasStrongAdSignal) {
      hideElement(el);
      return;
    }

    if (state.mode === 'regular') {
      if (iframeOrImage && hasWeakClassSignal && adSized) {
        hideElement(el);
      }
      return;
    }

    const suspiciousOverlayText = /(download|sponsored|advert|continue to site|watch now|install|special offer|promoted)/i.test(el.textContent || '');
    if ((hasWeakClassSignal && adSized) || (fixedOverlay && suspiciousOverlayText && adSized)) {
      hideElement(el);
    }
  }

  function isLikelyContentCard(el) {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName;
    const classes = safeClassName(el);
    const id = (el.id || '').toLowerCase();
    const text = `${classes} ${id}`;
    const hasPlayableMedia = !!el.querySelector?.('video, picture img, img[srcset], a[href*="watch"], a[href*="video"], a[href*="episode"]');
    const cardSignals = /(thumbnail|thumb|tile|card|grid|result|preview|poster|episode|playlist|catalog|listing|item)/i.test(text);
    return ['ARTICLE', 'LI'].includes(tag) || (hasPlayableMedia && cardSignals);
  }

  function safeClassName(el) {
    return typeof el.className === 'string' ? el.className : '';
  }

  function neutralizeFixedAds(root) {
    if (state.mode !== 'super' || !(root instanceof Element || root === document)) return;
    const candidates = root.querySelectorAll ? root.querySelectorAll('div, section, aside, iframe') : [];
    candidates.forEach((el) => {
      if (!(el instanceof Element) || el.dataset.iblockProcessed === '1' || isLikelyContentCard(el)) return;
      const style = window.getComputedStyle(el);
      const suspiciousText = /(advert|sponsored|promoted|watch ad|skip ad|install|claim reward|special offer)/i.test(el.textContent || '');
      const fixedOverlay = style.position === 'fixed' && Number.parseInt(style.zIndex || '0', 10) > 1000;
      const edgeDocked = fixedOverlay && (el.clientWidth > 200 || el.clientHeight > 100);
      if (suspiciousText && edgeDocked) {
        hideElement(el);
      }
    });
  }

  function hideElement(el) {
    if (!(el instanceof Element) || el.dataset.iblockProcessed === '1') return;
    el.dataset.iblockProcessed = '1';
    el.classList.add('iblock-hidden');
    state.blockedElements += 1;
    if (state.blockedElements % 10 === 1) {
      chrome.runtime.sendMessage({ type: 'incrementStat', key: 'blockedElements', value: 10 }).catch(() => {});
    }
  }

  function watchVideoSignals() {
    setInterval(detectVideoAds, 2500);
  }

  function detectVideoAds() {
    const hasVideo = document.querySelector('video');
    if (!hasVideo) return;

    const bodyText = document.body?.innerText?.slice(0, 4000) || '';
    const adShowing =
      document.querySelector('.ad-showing, .video-ads, .ytp-ad-module, .ytp-ad-player-overlay, .ytp-ad-overlay-container, [class*="ad-break"], [class*="ad-overlay"]') ||
      /\b(skip ad|advertisement|sponsored|commercial break|ad in \d|promotion)\b/i.test(bodyText);

    const hostnameMatch = state.knownVideoHost || /anime|stream|video|player/i.test(location.hostname);

    if (adShowing && hostnameMatch && !state.videoAdAlreadyLogged) {
      state.videoAdAlreadyLogged = true;
      chrome.runtime.sendMessage({ type: 'logVideoAd', hostname: location.hostname }).catch(() => {});
    }

    if (state.mode === 'super' && adShowing) {
      const overlays = document.querySelectorAll('.ytp-ad-module, .ytp-ad-image-overlay, .ytp-ad-overlay-container, .player-ad-overlay, [class*="ad-overlay"], [id*="ad-overlay"]');
      overlays.forEach(hideElement);

      const video = document.querySelector('video');
      if (video && /skip ad|advertisement|sponsored/i.test(bodyText)) {
        video.muted = true;
        const skipButton = Array.from(document.querySelectorAll('button, div[role="button"]')).find((entry) => /skip ad|skip ads/i.test(entry.textContent || ''));
        skipButton?.click?.();
      }
    }
  }

  function bumpPopupSuppressions() {
    state.popupSuppressions += 1;
    chrome.runtime.sendMessage({ type: 'incrementStat', key: 'popupSuppressions', value: 1 }).catch(() => {});
  }
})();
