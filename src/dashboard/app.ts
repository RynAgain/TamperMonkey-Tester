// ---------------------------------------------------------------------------
// TMDev Dashboard -- Application Logic
// Browser-side TypeScript. No Node.js APIs.
// ---------------------------------------------------------------------------

// --- Types ----------------------------------------------------------------

interface ScriptInfo {
  id: string;
  filePath: string;
  metadata: {
    name: string;
    version?: string;
    description?: string;
    author?: string;
    match: string[];
    include: string[];
    grant: string[];
    runAt: string;
    namespace?: string;
    exclude?: string[];
    require?: string[];
    resource?: Record<string, string>;
    connect?: string[];
    noframes?: boolean;
    icon?: string;
    homepageURL?: string;
  };
  enabled: boolean;
  lastModified: number;
}

interface ScriptDetail extends ScriptInfo {
  source: string;
}

interface ConsoleEntry {
  type: string;
  message: string;
  timestamp: number;
}

interface WSMessage {
  type: string;
  payload?: unknown;
  scriptId?: string;
  logType?: string;
  message?: string;
  timestamp?: number;
}

// --- State ----------------------------------------------------------------

let scripts: ScriptInfo[] = [];
let selectedScriptId: string | null = null;
let ws: WebSocket | null = null;
let activeTab: 'console' | 'storage' | 'info' = 'console';
const consoleLogs: ConsoleEntry[] = [];
let cachedDetail: ScriptDetail | null = null;
let cachedStorage: Record<string, unknown> | null = null;
let showFullSource = false;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

// --- DOM Refs (resolved once on init) -------------------------------------

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

// --- API Functions --------------------------------------------------------

const API_BASE = '/__tmdev__/api';

async function fetchScripts(): Promise<ScriptInfo[]> {
  const res = await fetch(`${API_BASE}/scripts`);
  if (!res.ok) throw new Error(`Failed to fetch scripts: ${res.status}`);
  return res.json();
}

async function toggleScript(id: string, enabled: boolean): Promise<void> {
  await fetch(`${API_BASE}/scripts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

async function fetchStorage(scriptId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/storage/${encodeURIComponent(scriptId)}`);
  if (!res.ok) throw new Error(`Failed to fetch storage: ${res.status}`);
  return res.json();
}

async function deleteStorageKey(scriptId: string, key: string): Promise<void> {
  await fetch(`${API_BASE}/storage`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptId, key }),
  });
}

async function fetchScriptDetail(id: string): Promise<ScriptDetail> {
  const res = await fetch(`${API_BASE}/scripts/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch script detail: ${res.status}`);
  return res.json();
}

// --- WebSocket ------------------------------------------------------------

function setConnectionStatus(state: 'connected' | 'disconnected' | 'connecting'): void {
  const labels: Record<string, string> = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
  };

  const headerDot = $('#connection-indicator');
  const headerLabel = $('#connection-label');
  const footerDot = $('#footer-status-dot');
  const footerText = $('#footer-status-text');

  for (const dot of [headerDot, footerDot]) {
    if (dot) {
      dot.className = `status-dot ${state}`;
      dot.title = labels[state];
    }
  }

  if (headerLabel) headerLabel.textContent = labels[state];
  if (footerText) footerText.textContent = labels[state];
}

function connectWebSocket(): void {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/__tmdev__/ws`;

  setConnectionStatus('connecting');

  try {
    ws = new WebSocket(wsUrl);
  } catch {
    setConnectionStatus('disconnected');
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    setConnectionStatus('connected');
    addConsoleEntry('info', '[ws] Connected to dev server');
  };

  ws.onclose = () => {
    setConnectionStatus('disconnected');
    addConsoleEntry('warn', '[ws] Connection lost');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };

  ws.onmessage = (event: MessageEvent) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }

    switch (msg.type) {
      case 'script-change':
        handleScriptChange();
        break;

      case 'console':
        addConsoleEntry(
          msg.logType ?? 'log',
          typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.payload ?? ''),
        );
        break;

      case 'notification':
        addConsoleEntry(
          'notification',
          typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.payload ?? ''),
        );
        break;

      default:
        addConsoleEntry('info', `[ws] Unknown message type: ${msg.type}`);
    }
  };
}

function scheduleReconnect(): void {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, 3000);
}

async function handleScriptChange(): Promise<void> {
  try {
    scripts = await fetchScripts();
    // If the selected script is gone, deselect
    if (selectedScriptId && !scripts.find((s) => s.id === selectedScriptId)) {
      selectedScriptId = null;
      cachedDetail = null;
      cachedStorage = null;
    }
    renderScriptList();
    renderTabs();
    renderStatusBar();
  } catch {
    addConsoleEntry('error', '[api] Failed to refresh scripts');
  }
}

// --- Console Helpers ------------------------------------------------------

function addConsoleEntry(type: string, message: string): void {
  consoleLogs.push({ type, message, timestamp: Date.now() });
  // Cap at 500 entries
  if (consoleLogs.length > 500) {
    consoleLogs.splice(0, consoleLogs.length - 500);
  }
  if (activeTab === 'console') {
    renderConsoleTab();
  }
}

// --- Rendering ------------------------------------------------------------

function renderScriptList(): void {
  const container = $('#scripts-list');
  const countBadge = $('#script-count');
  if (!container) return;

  if (countBadge) countBadge.textContent = String(scripts.length);

  if (scripts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">[ ]</div>
        <div class="empty-state-text">No scripts discovered yet.<br>Add .user.js files to your scripts directory.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  for (const script of scripts) {
    const card = document.createElement('div');
    card.className = `script-card${script.id === selectedScriptId ? ' selected' : ''}`;
    card.dataset.id = script.id;

    const matchTags = [...(script.metadata.match ?? []), ...(script.metadata.include ?? [])]
      .slice(0, 3)
      .map((m) => `<span class="match-tag">${escapeHtml(m)}</span>`)
      .join('');
    const moreCount =
      (script.metadata.match?.length ?? 0) + (script.metadata.include?.length ?? 0) - 3;
    const moreTag = moreCount > 0 ? `<span class="match-tag">+${moreCount} more</span>` : '';

    card.innerHTML = `
      <div class="script-card-header">
        <span class="script-card-name">${escapeHtml(script.metadata.name)}</span>
        ${script.metadata.version ? `<span class="badge badge-version">v${escapeHtml(script.metadata.version)}</span>` : ''}
        <label class="toggle-switch" title="${script.enabled ? 'Disable' : 'Enable'}">
          <input type="checkbox" ${script.enabled ? 'checked' : ''} data-toggle-id="${script.id}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      ${script.metadata.description ? `<div class="script-card-desc">${escapeHtml(script.metadata.description)}</div>` : ''}
      <div class="script-card-matches">${matchTags}${moreTag}</div>
    `;

    // Click to select
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Don't select when clicking the toggle
      if (target.closest('.toggle-switch')) return;
      selectScript(script.id);
    });

    // Toggle enabled
    const toggle = card.querySelector('input[data-toggle-id]') as HTMLInputElement | null;
    if (toggle) {
      toggle.addEventListener('change', async (e) => {
        e.stopPropagation();
        const enabled = toggle.checked;
        try {
          await toggleScript(script.id, enabled);
          const s = scripts.find((x) => x.id === script.id);
          if (s) s.enabled = enabled;
          renderStatusBar();
        } catch {
          addConsoleEntry('error', `[api] Failed to toggle ${script.metadata.name}`);
          toggle.checked = !enabled; // revert
        }
      });
    }

    container.appendChild(card);
  }
}

async function selectScript(id: string): Promise<void> {
  selectedScriptId = id;
  cachedDetail = null;
  cachedStorage = null;
  showFullSource = false;
  renderScriptList();
  renderTabs();

  // Pre-fetch detail for info tab
  try {
    cachedDetail = await fetchScriptDetail(id);
  } catch {
    // silent
  }

  // Pre-fetch storage
  try {
    cachedStorage = await fetchStorage(id);
  } catch {
    // silent
  }

  // Re-render current tab to show fetched data
  renderTabs();
}

function renderTabs(): void {
  // Update tab button states
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach((btn) => {
    const tab = (btn as HTMLElement).dataset.tab;
    if (tab === activeTab) {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    }
  });

  // Render active tab content
  switch (activeTab) {
    case 'console':
      renderConsoleTab();
      break;
    case 'storage':
      renderStorageTab();
      break;
    case 'info':
      renderInfoTab();
      break;
  }
}

function renderConsoleTab(): void {
  const container = $('#tab-content');
  if (!container) return;

  if (consoleLogs.length === 0) {
    container.innerHTML = `
      <div class="console-toolbar">
        <span class="text-muted">Console</span>
      </div>
      <div class="empty-state">
        <div class="empty-state-icon">&gt;_</div>
        <div class="empty-state-text">Console output will appear here.</div>
      </div>
    `;
    return;
  }

  // Build only if the content doesn't already have a console-output
  let output = container.querySelector('.console-output') as HTMLElement | null;
  const shouldRebuild = !output || container.dataset.activeTab !== 'console';
  container.dataset.activeTab = 'console';

  if (shouldRebuild) {
    container.innerHTML = `
      <div class="console-toolbar">
        <span class="text-muted">${consoleLogs.length} entries</span>
        <button class="btn btn-sm btn-ghost" id="console-clear">Clear</button>
      </div>
      <div class="console-output"></div>
    `;
    output = container.querySelector('.console-output');
    const clearBtn = container.querySelector('#console-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        consoleLogs.length = 0;
        renderConsoleTab();
      });
    }
  } else {
    // Update the count
    const toolbar = container.querySelector('.console-toolbar span');
    if (toolbar) toolbar.textContent = `${consoleLogs.length} entries`;
  }

  if (!output) return;

  // Render lines
  output.innerHTML = '';
  for (const entry of consoleLogs) {
    const line = document.createElement('div');
    line.className = `console-line ${entry.type}`;

    const time = new Date(entry.timestamp);
    const ts = `${pad2(time.getHours())}:${pad2(time.getMinutes())}:${pad2(time.getSeconds())}`;

    line.innerHTML = `
      <span class="console-line-time">${ts}</span>
      <span class="console-line-type">${escapeHtml(entry.type)}</span>
      <span class="console-line-msg">${escapeHtml(entry.message)}</span>
    `;
    output.appendChild(line);
  }

  // Auto-scroll to bottom
  output.scrollTop = output.scrollHeight;
}

function renderStorageTab(): void {
  const container = $('#tab-content');
  if (!container) return;
  container.dataset.activeTab = 'storage';

  if (!selectedScriptId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">{ }</div>
        <div class="empty-state-text">Select a script to inspect its storage.</div>
      </div>
    `;
    return;
  }

  if (!cachedStorage) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">...</div>
        <div class="empty-state-text">Loading storage...</div>
      </div>
    `;
    // Trigger fetch
    fetchStorage(selectedScriptId).then((data) => {
      cachedStorage = data;
      if (activeTab === 'storage') renderStorageTab();
    }).catch(() => {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">!</div>
          <div class="empty-state-text">Failed to load storage.</div>
        </div>
      `;
    });
    return;
  }

  const keys = Object.keys(cachedStorage);
  if (keys.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">{ }</div>
        <div class="empty-state-text">No storage entries for this script.</div>
      </div>
    `;
    return;
  }

  const rows = keys
    .map((key) => {
      const val = cachedStorage![key];
      const valStr = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
      return `
        <tr>
          <td><span class="storage-key">${escapeHtml(key)}</span></td>
          <td><span class="storage-value">${escapeHtml(valStr)}</span></td>
          <td>
            <button class="btn btn-sm btn-danger btn-ghost" data-delete-key="${escapeAttr(key)}" title="Delete">
              x
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="storage-table-wrapper">
      <table class="storage-table">
        <thead>
          <tr>
            <th style="width:200px">Key</th>
            <th>Value</th>
            <th style="width:60px">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  // Attach delete handlers
  container.querySelectorAll('[data-delete-key]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = (btn as HTMLElement).dataset.deleteKey!;
      if (!selectedScriptId) return;
      try {
        await deleteStorageKey(selectedScriptId, key);
        if (cachedStorage) delete cachedStorage[key];
        renderStorageTab();
        addConsoleEntry('info', `[storage] Deleted key: ${key}`);
      } catch {
        addConsoleEntry('error', `[storage] Failed to delete key: ${key}`);
      }
    });
  });
}

function renderInfoTab(): void {
  const container = $('#tab-content');
  if (!container) return;
  container.dataset.activeTab = 'info';

  if (!selectedScriptId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">i</div>
        <div class="empty-state-text">Select a script to view its details.</div>
      </div>
    `;
    return;
  }

  const script = cachedDetail || scripts.find((s) => s.id === selectedScriptId);
  if (!script) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">?</div>
        <div class="empty-state-text">Script not found.</div>
      </div>
    `;
    return;
  }

  const m = script.metadata;

  // Build metadata rows
  const metaRows: string[] = [];

  const addRow = (label: string, value: string | undefined | null): void => {
    if (value) {
      metaRows.push(`<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`);
    }
  };

  const addTagRow = (label: string, items: string[] | undefined): void => {
    if (items && items.length > 0) {
      const tags = items.map((i) => `<span class="tag">${escapeHtml(i)}</span>`).join('');
      metaRows.push(`<dt>${escapeHtml(label)}</dt><dd>${tags}</dd>`);
    }
  };

  addRow('Name', m.name);
  addRow('Version', m.version);
  addRow('Description', m.description);
  addRow('Author', m.author);
  addRow('Namespace', m.namespace);
  addRow('Run At', m.runAt);
  addTagRow('Match', m.match);
  addTagRow('Include', m.include);
  addTagRow('Exclude', m.exclude);
  addTagRow('Grant', m.grant);
  addTagRow('Require', m.require);
  addTagRow('Connect', m.connect);
  addRow('No Frames', m.noframes ? 'Yes' : undefined);
  addRow('Icon', m.icon);
  addRow('Homepage', m.homepageURL);
  addRow('File Path', script.filePath);
  addRow('Last Modified', new Date(script.lastModified).toLocaleString());

  // Source code section
  let sourceSection = '';
  const detail = cachedDetail;
  if (detail && detail.source) {
    const lines = detail.source.split('\n');
    const maxPreview = 50;
    const displayLines = showFullSource ? lines : lines.slice(0, maxPreview);
    const truncated = !showFullSource && lines.length > maxPreview;

    sourceSection = `
      <div class="source-preview">
        <div class="source-preview-header">
          <h3>Source Code (${lines.length} lines)</h3>
          ${truncated ? '<button class="btn btn-sm btn-ghost" id="show-full-source">Show full source</button>' : ''}
          ${showFullSource && lines.length > maxPreview ? '<button class="btn btn-sm btn-ghost" id="collapse-source">Collapse</button>' : ''}
        </div>
        <pre class="source-code">${escapeHtml(displayLines.join('\n'))}</pre>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="info-panel">
      <dl class="metadata-grid">${metaRows.join('')}</dl>
      ${sourceSection}
    </div>
  `;

  // Source toggle handlers
  const showBtn = container.querySelector('#show-full-source');
  if (showBtn) {
    showBtn.addEventListener('click', () => {
      showFullSource = true;
      renderInfoTab();
    });
  }
  const collapseBtn = container.querySelector('#collapse-source');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      showFullSource = false;
      renderInfoTab();
    });
  }
}

function renderStatusBar(): void {
  const statsEl = $('#footer-script-stats');
  const enabledEl = $('#footer-enabled-stats');
  if (statsEl) {
    statsEl.textContent = `${scripts.length} script${scripts.length !== 1 ? 's' : ''}`;
  }
  if (enabledEl) {
    const enabled = scripts.filter((s) => s.enabled).length;
    enabledEl.textContent = `${enabled} enabled`;
  }
}

// --- URL Bar --------------------------------------------------------------

function setupUrlBar(): void {
  const input = $('#url-input') as HTMLInputElement | null;
  const goBtn = $('#url-go');

  if (!input || !goBtn) return;

  const navigate = (): void => {
    let url = input.value.trim();
    if (!url) return;

    // Ensure protocol
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }

    // Open the proxied URL in a new tab
    // The proxy handler will intercept and inject scripts
    window.open(`/${url}`, '_blank');
    addConsoleEntry('info', `[nav] Opened proxy for: ${url}`);
  };

  goBtn.addEventListener('click', navigate);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigate();
    }
  });
}

// --- Tab Navigation -------------------------------------------------------

function setupTabs(): void {
  const tabBar = $('#tab-bar');
  if (!tabBar) return;

  tabBar.addEventListener('click', (e: Event) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('.tab-btn') as HTMLElement | null;
    if (!btn) return;

    const tab = btn.dataset.tab as typeof activeTab;
    if (tab && tab !== activeTab) {
      activeTab = tab;
      renderTabs();
    }
  });
}

// --- Utilities ------------------------------------------------------------

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

// --- Init -----------------------------------------------------------------

async function init(): Promise<void> {
  // Load initial scripts
  try {
    scripts = await fetchScripts();
  } catch {
    addConsoleEntry('error', '[api] Failed to load scripts on init');
  }

  // Setup UI handlers
  setupUrlBar();
  setupTabs();

  // Initial render
  renderScriptList();
  renderTabs();
  renderStatusBar();

  // Connect WebSocket
  connectWebSocket();

  addConsoleEntry('info', '[tmdev] Dashboard initialized');
}

document.addEventListener('DOMContentLoaded', init);
