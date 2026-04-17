const regularBtn = document.getElementById('regularBtn');
const superBtn = document.getElementById('superBtn');
const modeDescription = document.getElementById('modeDescription');
const blockedElements = document.getElementById('blockedElements');
const popupSuppressions = document.getElementById('popupSuppressions');
const videoAdDetections = document.getElementById('videoAdDetections');
const siteCount = document.getElementById('siteCount');
const siteLog = document.getElementById('siteLog');
const clearLogBtn = document.getElementById('clearLogBtn');
const whitelistCount = document.getElementById('whitelistCount');
const whitelistLog = document.getElementById('whitelistLog');
const whitelistForm = document.getElementById('whitelistForm');
const whitelistInput = document.getElementById('whitelistInput');
const whitelistHint = document.getElementById('whitelistHint');

const descriptions = {
  regular: 'Regular mode focuses on common banners, still-image ads, GIFs, sponsored boxes, ad iframes, and pop-up/tab-under traps with reduced false positives on video-heavy sites.',
  super: 'Super mode keeps Regular protections and adds broader request blocking plus stricter in-page and player-overlay heuristics. It is stronger, but still not a universal answer for every stitched stream ad.'
};

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  const mode = state.mode || 'regular';
  regularBtn.classList.toggle('active', mode === 'regular');
  superBtn.classList.toggle('active', mode === 'super');
  modeDescription.textContent = descriptions[mode];

  const stats = state.stats || {};
  blockedElements.textContent = String(stats.blockedElements || 0);
  popupSuppressions.textContent = String(stats.popupSuppressions || 0);
  videoAdDetections.textContent = String(stats.videoAdDetections || 0);

  const domains = Array.isArray(state.siteLog) ? state.siteLog : [];
  siteCount.textContent = String(domains.length);
  siteLog.innerHTML = '';

  if (!domains.length) {
    const el = document.createElement('div');
    el.className = 'log-item';
    el.textContent = 'No sites have been logged yet.';
    siteLog.appendChild(el);
  } else {
    domains.forEach((domain) => {
      const el = document.createElement('div');
      el.className = 'log-item';
      el.textContent = domain;
      siteLog.appendChild(el);
    });
  }

  const whitelist = Array.isArray(state.whitelist) ? state.whitelist : [];
  whitelistCount.textContent = `${whitelist.length}/50`;
  whitelistLog.innerHTML = '';
  whitelistHint.textContent = whitelist.length >= 50
    ? 'Whitelist is full. Remove a site before adding another.'
    : 'Whitelisted domains bypass both page-level blocking and request blocking. Subdomains are included automatically.';

  if (!whitelist.length) {
    const el = document.createElement('div');
    el.className = 'log-item';
    el.textContent = 'No whitelisted sites yet.';
    whitelistLog.appendChild(el);
  } else {
    whitelist.forEach((domain) => {
      const row = document.createElement('div');
      row.className = 'whitelist-row';

      const label = document.createElement('span');
      label.textContent = domain;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger ghost';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'removeWhitelist', hostname: domain });
        refresh();
      });

      row.append(label, remove);
      whitelistLog.appendChild(row);
    });
  }
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

whitelistForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = whitelistInput.value.trim();
  if (!value) return;
  const response = await chrome.runtime.sendMessage({ type: 'addWhitelist', hostname: value });
  whitelistInput.value = '';
  whitelistHint.textContent = response?.ok === false && response?.error ? response.error : whitelistHint.textContent;
  refresh();
});

refresh();
