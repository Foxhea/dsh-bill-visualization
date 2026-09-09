/** DOM attachment is pinned to Harness 0.1.3-alpha.2's named sidebar settings slot. */
(() => {
  const ID = 'dsh-bill-visualization-launcher';
  function mount() {
    if (document.getElementById('dsh-bill-visualization-modal')) return;
    const host = document.createElement('div'); host.id = ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{display:block;min-width:0;width:100%;margin:6px 0 8px;font-family:inherit;color:var(--dsw-alias-label-primary,#203b35)}
      *{box-sizing:border-box}button{font:inherit;cursor:pointer}#open{width:100%;display:flex;align-items:center;gap:11px;border:1px solid color-mix(in srgb,currentColor 9%,transparent);border-radius:12px;padding:11px 12px;text-align:left;color:inherit;background:color-mix(in srgb,#55987e 7%,transparent);transition:background .15s,border-color .15s}
      #open:hover{background:color-mix(in srgb,#55987e 15%,transparent);border-color:color-mix(in srgb,#55987e 35%,transparent)}button:focus-visible{outline:2px solid #489e80;outline-offset:3px}
      .mark{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:color-mix(in srgb,#55987e 13%,transparent);color:#40896d;flex:none}.copy{display:grid;gap:4px;min-width:0}.title{font:600 13px system-ui,sans-serif;white-space:nowrap}.subtitle{font:10px system-ui,sans-serif;letter-spacing:.45px;opacity:.5}.arrow{margin-left:auto;opacity:.35;font:18px system-ui}
      :host([data-collapsed]){margin:4px 0 8px;width:36px}:host([data-collapsed]) #open{height:36px;width:36px;border-color:transparent;background:transparent;padding:0;justify-content:center}:host([data-collapsed]) .mark{background:transparent}:host([data-collapsed]) .copy,:host([data-collapsed]) .arrow{display:none}
      @media(prefers-reduced-motion:reduce){#open{transition:none}}
    </style><button id="open" type="button" aria-label="Token / 费用" aria-haspopup="dialog" title="Token / 费用"><span class="mark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 19V12M12 19V5M19 19V9"/><path d="M3 22h18" opacity=".35"/></svg></span><span class="copy"><span class="title">Token / 费用</span><span class="subtitle">用量统计 · TOKEN LEDGER</span></span><span class="arrow" aria-hidden="true">›</span></button>`;
    const modalHost = document.createElement('div'); modalHost.id = 'dsh-bill-visualization-modal';
    const modalRoot = modalHost.attachShadow({ mode: 'open' });
    modalRoot.innerHTML = `<style>
      dialog{padding:0;border:1px solid #dbe4df;border-radius:20px;width:min(1320px,95vw);height:92vh;max-width:95vw;max-height:95vh;background:#f5f7f6;box-shadow:0 24px 100px #0e282e55;overflow:hidden}
      dialog::backdrop{background:#10282777;backdrop-filter:blur(5px)}header{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;color:#64776d;font:500 10px system-ui;letter-spacing:1.2px;border-bottom:1px solid #e2e8e4;background:#fafcfb}
      button{width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:#69766f;cursor:pointer;font:20px system-ui}button:hover{background:#e7eee9}button:focus-visible{outline:2px solid #489e80}iframe{width:100%;height:calc(100% - 45px);border:0;display:block;background:#f5f7f6}
      @media(max-width:600px){dialog{width:98vw;max-width:98vw;height:96vh;max-height:96vh;border-radius:12px}header{padding:0 12px}}
    </style><dialog aria-label="Token 与费用统计"><header><span>TOKEN LEDGER / 本地用量</span><button id="close" type="button" aria-label="关闭统计窗口">×</button></header><iframe title="Token 与费用统计仪表盘"></iframe></dialog>`;
    const dialog = modalRoot.querySelector('dialog'), opener = root.querySelector('#open');
    const frame = modalRoot.querySelector('iframe');
    opener.addEventListener('click', () => { if (!frame.getAttribute('src')) frame.src = '/dsh-bill-visualization'; dialog.showModal(); });
    modalRoot.querySelector('#close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (host.isConnected) opener.focus(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    frame.addEventListener('load', () => {
      frame.contentDocument?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); dialog.close(); } });
    });
    document.body.append(modalHost);
    const resize = new ResizeObserver(entries => { for (const entry of entries) host.toggleAttribute('data-collapsed', entry.contentRect.width < 100); });
    let target;
    function attach() {
      const slot = document.querySelector('[data-slot="sidebar.settings"]');
      if (!slot?.parentElement) { if (host.isConnected) host.remove(); return; }
      // Settings switches to a horizontal flex row when collapsed. Attach above
      // that row in the footer, whose width is independent of our button text.
      const settingsArea = slot.parentElement;
      const parent = settingsArea.parentElement;
      if (!parent) return;
      if (target !== parent) { resize.disconnect(); target = parent; resize.observe(parent); }
      if (host.parentElement !== parent || host.nextSibling !== settingsArea) parent.insertBefore(host, settingsArea);
    }
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; attach(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    attach();
    window.addEventListener('pagehide', () => { observer.disconnect(); resize.disconnect(); }, { once: true });
    window.addEventListener('pageshow', event => { if (event.persisted) { observer.observe(document.body, { childList:true,subtree:true }); target = undefined; attach(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
