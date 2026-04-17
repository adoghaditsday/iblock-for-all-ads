const DEFAULT_SETTINGS = {
  mode: 'regular',
  siteLog: [],
  whitelist: [],
  stats: {
    blockedElements: 0,
    popupSuppressions: 0,
    videoAdDetections: 0
  }
};

const MAX_WHITELIST = 50;
const DYNAMIC_ALLOW_RULE_START = 10000;
const DYNAMIC_ALLOW_RULE_END = 10149;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(['mode', 'siteLog', 'stats', 'whitelist']);
  const next = {
    mode: current.mode || DEFAULT_SETTINGS.mode,
    siteLog: Array.isArray(current.siteLog) ? current.siteLog : [],
    whitelist: sanitizeWhitelist(current.whitelist),
    stats: current.stats || DEFAULT_SETTINGS.stats
  };
  await chrome.storage.local.set(next);
  await applyMode(next.mode);
  await syncWhitelistRules(next.whitelist);
});

chrome.runtime.onStartup.addListener(async () => {
  const { mode, whitelist } = await chrome.storage.local.get(['mode', 'whitelist']);
  await applyMode(mode || DEFAULT_SETTINGS.mode);
  await syncWhitelistRules(sanitizeWhitelist(whitelist));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error('iBlock error:', error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'getState': {
      const data = await chrome.storage.local.get(['mode', 'siteLog', 'stats', 'whitelist']);
      return {
        mode: data.mode || DEFAULT_SETTINGS.mode,
        siteLog: Array.isArray(data.siteLog) ? data.siteLog : [],
        whitelist: sanitizeWhitelist(data.whitelist),
        stats: data.stats || DEFAULT_SETTINGS.stats,
        currentHost: normalizeHost(message.hostname || sender?.url || '')
      };
    }
    case 'setMode': {
      const mode = message.mode === 'super' ? 'super' : 'regular';
      await chrome.storage.local.set({ mode });
      await applyMode(mode);
      return { mode };
    }
    case 'logVideoAd': {
      const hostname = normalizeHost(message.hostname || sender?.url || '');
      if (!hostname) return {};

      const { siteLog = [], stats = DEFAULT_SETTINGS.stats } = await chrome.storage.local.get(['siteLog', 'stats']);
      const existing = new Set(siteLog);
      if (!existing.has(hostname)) {
        existing.add(hostname);
        await chrome.storage.local.set({ siteLog: Array.from(existing).sort() });
      }
      stats.videoAdDetections = (stats.videoAdDetections || 0) + 1;
      await chrome.storage.local.set({ stats });
      return { logged: hostname };
    }
    case 'incrementStat': {
      const key = message.key;
      if (!['blockedElements', 'popupSuppressions', 'videoAdDetections'].includes(key)) {
        return {};
      }
      const { stats = DEFAULT_SETTINGS.stats } = await chrome.storage.local.get('stats');
      stats[key] = (stats[key] || 0) + (Number(message.value) || 1);
      await chrome.storage.local.set({ stats });
      return { stats };
    }
    case 'clearLog': {
      await chrome.storage.local.set({ siteLog: [] });
      return { siteLog: [] };
    }
    case 'addWhitelist': {
      const host = normalizeHost(message.hostname || sender?.url || '');
      if (!host) {
        throw new Error('Invalid website.');
      }
      const { whitelist = [] } = await chrome.storage.local.get('whitelist');
      const next = sanitizeWhitelist([...whitelist, host]);
      if (!next.includes(host) && next.length >= MAX_WHITELIST) {
        throw new Error(`Whitelist limit reached (${MAX_WHITELIST}).`);
      }
      if (next.length > MAX_WHITELIST) {
        throw new Error(`Whitelist limit reached (${MAX_WHITELIST}).`);
      }
      await chrome.storage.local.set({ whitelist: next });
      await syncWhitelistRules(next);
      return { whitelist: next, added: host };
    }
    case 'removeWhitelist': {
      const host = normalizeHost(message.hostname || sender?.url || '');
      const { whitelist = [] } = await chrome.storage.local.get('whitelist');
      const next = sanitizeWhitelist(whitelist.filter((item) => item !== host));
      await chrome.storage.local.set({ whitelist: next });
      await syncWhitelistRules(next);
      return { whitelist: next, removed: host };
    }
    default:
      return {};
  }
}

async function applyMode(mode) {
  const enableRulesets = mode === 'super' ? ['regular_rules', 'super_rules'] : ['regular_rules'];
  const disableRulesets = mode === 'super' ? [] : ['super_rules'];

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enableRulesets,
    disableRulesetIds: disableRulesets
  });
}

async function syncWhitelistRules(whitelist) {
  const clean = sanitizeWhitelist(whitelist);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .map((rule) => rule.id)
    .filter((id) => id >= DYNAMIC_ALLOW_RULE_START && id <= DYNAMIC_ALLOW_RULE_END);

  const addRules = clean.map((host, index) => ({
    id: DYNAMIC_ALLOW_RULE_START + index,
    priority: 1000,
    action: { type: 'allowAllRequests' },
    condition: {
      initiatorDomains: [host],
      resourceTypes: [
        'main_frame', 'sub_frame', 'script', 'image', 'media', 'font', 'stylesheet',
        'xmlhttprequest', 'other', 'ping', 'object', 'webbundle', 'websocket'
      ]
    }
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });
}

function sanitizeWhitelist(list) {
  const unique = [];
  const seen = new Set();
  for (const value of Array.isArray(list) ? list : []) {
    const host = normalizeHost(value);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    unique.push(host);
    if (unique.length >= MAX_WHITELIST) break;
  }
  return unique.sort();
}

function normalizeHost(input) {
  try {
    if (!input) return '';
    if (/^https?:/i.test(input)) {
      return new URL(input).hostname.replace(/^www\./i, '').toLowerCase();
    }
    const cleaned = String(input).trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    if (!cleaned || cleaned.includes(' ') || !cleaned.includes('.')) return '';
    return cleaned;
  } catch {
    return '';
  }
}
