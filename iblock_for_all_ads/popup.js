const regularBtn = document.getElementById('regularBtn');
const superBtn = document.getElementById('superBtn');
const modeDescription = document.getElementById('modeDescription');
const blockedElements = document.getElementById('blockedElements');
const popupSuppressions = document.getElementById('popupSuppressions');
const siteCount = document.getElementById('siteCount');
const siteLog = document.getElementById('siteLog');
const clearLogBtn = document.getElementById('clearLogBtn');
const openOptions = document.getElementById('openOptions');
const currentSite = document.getElementById('currentSite');
const toggleWhitelistBtn = document.getElementById('toggleWhitelistBtn');
const whitelistCount = document.getElementById('whitelistCount');

const descriptions = {
  regular: 'Regular mode blocks common banners, GIFs, image ads, ad iframes, and popup traps with tighter filters to avoid normal video thumbnails and preview grids.',
  super: 'Super mode adds broader network rules and stronger page/player heuristics. It may block more overlays and some video-ad UI, but cannot guarantee every server-stitched stream ad.'
};

let stateCache = null;
let activeHost = '';

async function getActiveHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return tab?.url ? new URL(tab.url).hostname.replace(/^www\./i, '').toLowerCase() : '';
  } catch {
    return '';
  }
}

function hostMatchesWhitelist(host, whitelist) {
  return whitelist.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

async function refresh() {
  activeHost = await getActiveHost();
  const response = await chrome.runtime.sendMessage({ type: 'getState', hostname: activeHost });
  stateCache = response;

  const mode = response.mode || 'regular';
  regularBtn.classList.toggle('active', mode === 'regular');
  superBtn.classList.toggle('active', mode === 'super');
  modeDescription.textContent = descriptions[mode];

  const stats = response.stats || {};
  blockedElements.textContent = String(stats.blockedElements || 0);
  popupSuppressions.textContent = String(stats.popupSuppressions || 0);

  const domains = Array.isArray(response.siteLog) ? response.siteLog : [];
  siteCount.textContent = String(domains.length);
  siteLog.innerHTML = '';
  if (!domains.length) {
    const li = document.createElement('li');
    li.textContent = 'No video-ad detections logged yet.';
    siteLog.appendChild(li);
  } else {
    domains.slice(0, 10).forEach((domain) => {
      const li = document.createElement('li');
      li.textContent = domain;
      siteLog.appendChild(li);
    });
  }

  const whitelist = Array.isArray(response.whitelist) ? response.whitelist : [];
  whitelistCount.textContent = `${whitelist.length}/50`;
  currentSite.textContent = activeHost || 'Unavailable';

  const whitelisted = activeHost && hostMatchesWhitelist(activeHost, whitelist);
  toggleWhitelistBtn.textContent = whitelisted ? 'Remove from whitelist' : 'Add to whitelist';
  toggleWhitelistBtn.disabled = !activeHost || (!whitelisted && whitelist.length >= 50);
}

regularBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'setMode', mode: 'regular' });
  refresh();
});

superBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'setMode', mode: 'super' });
  refresh();
});

clearLogBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clearLog' });
  refresh();
});

toggleWhitelistBtn.addEventListener('click', async () => {
  if (!activeHost || !stateCache) return;
  const whitelist = Array.isArray(stateCache.whitelist) ? stateCache.whitelist : [];
  const whitelisted = hostMatchesWhitelist(activeHost, whitelist);
  const type = whitelisted ? 'removeWhitelist' : 'addWhitelist';
  const response = await chrome.runtime.sendMessage({ type, hostname: activeHost });
  if (!response?.ok && response?.error) {
    currentSite.textContent = response.error;
  }
  refresh();
});

openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
refresh();
