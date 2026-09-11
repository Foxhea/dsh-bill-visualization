/** DOM attachment is pinned to Harness 0.1.3-alpha.2's named sidebar settings slot. */
(() => {
  const ID = 'dsh-bill-visualization-launcher';
  function mount() {
    if (document.getElementById('dsh-bill-visualization-modal')) return;
    const host = document.createElement('div'); host.id = ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      /* Host design tokens (--dsw-*) are inherited into this shadow root, so the
         launcher tracks the Harness theme — light or dark — with no local palette. */
      :host{display:block;min-width:0;width:100%;margin:6px 0 8px;font-family:inherit;color:var(--dsw-alias-label-primary,#0f1115)}
      *{box-sizing:border-box}button{font:inherit;cursor:pointer}#open{width:100%;display:flex;align-items:center;gap:11px;border:1px solid transparent;border-radius:12px;padding:10px 11px;text-align:left;color:inherit;background:transparent;transition:background .2s cubic-bezier(.4,0,.2,1),border-color .2s cubic-bezier(.4,0,.2,1)}
      #open:hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(38,49,72,.06));border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1))}
      #open:active{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-static-neutral-bluish-100,rgb(235,238,242)))}button:focus-visible{outline:2px solid var(--dsw-alias-link,rgb(65,118,230));outline-offset:2px}
      .mark{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--dsw-alias-bg-module-platform,var(--dsw-static-neutral-bluish-60,rgb(245,246,247)));color:var(--dsw-alias-link,rgb(65,118,230));flex:none}.copy{display:grid;gap:4px;min-width:0}.title{font-size:13px;font-weight:600;white-space:nowrap}.subtitle{font-size:10px;letter-spacing:.45px;color:var(--dsw-alias-label-tertiary,rgb(129,133,140))}.arrow{margin-left:auto;color:var(--dsw-alias-label-tertiary,rgb(129,133,140));font-size:18px;line-height:1}
      :host([data-collapsed]){margin:4px 0 8px;width:36px}:host([data-collapsed]) #open{height:36px;width:36px;border-color:transparent;background:transparent;padding:0;justify-content:center}:host([data-collapsed]) .mark{background:transparent}:host([data-collapsed]) .copy,:host([data-collapsed]) .arrow{display:none}
      @media(prefers-reduced-motion:reduce){#open{transition:none}}
    </style><button id="open" type="button" aria-label="Token / 费用" aria-haspopup="dialog" title="Token / 费用"><span class="mark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 19V12M12 19V5M19 19V9"/><path d="M3 22h18" opacity=".35"/></svg></span><span class="copy"><span class="title">Token / 费用</span><span class="subtitle">用量统计 · TOKEN LEDGER</span></span><span class="arrow" aria-hidden="true">›</span></button>`;
    const modalHost = document.createElement('div'); modalHost.id = 'dsh-bill-visualization-modal';
    const modalRoot = modalHost.attachShadow({ mode: 'open' });
    modalRoot.innerHTML = `<style>
      dialog{padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:16px;width:min(1320px,95vw);height:92vh;max-width:95vw;max-height:95vh;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--dsw-font-family,system-ui,sans-serif);box-shadow:0 24px 100px rgba(15,17,21,.32);overflow:hidden}
      dialog::backdrop{background:var(--dsw-alias-bg-mask-3,rgba(0,0,0,.48));backdrop-filter:blur(5px)}header{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;color:var(--dsw-alias-label-tertiary,rgb(129,133,140));font-size:10px;font-weight:500;letter-spacing:1.2px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-module-platform,var(--dsw-static-neutral-bluish-60,rgb(245,246,247)))}
      button{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,rgb(97,102,107));cursor:pointer;font-size:20px;line-height:1}button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}button:focus-visible{outline:2px solid var(--dsw-alias-link,rgb(65,118,230));outline-offset:2px}iframe{width:100%;height:calc(100% - 45px);border:0;display:block;background:var(--dsw-alias-bg-base,#fff)}
      @media(max-width:600px){dialog{width:98vw;max-width:98vw;height:96vh;max-height:96vh;border-radius:12px}header{padding:0 12px}}
    </style><dialog aria-label="Token 与费用统计"><header><span>TOKEN LEDGER / 本地用量</span><button id="close" type="button" aria-label="关闭统计窗口">×</button></header><iframe title="Token 与费用统计仪表盘"></iframe></dialog>`;
    const dialog = modalRoot.querySelector('dialog'), opener = root.querySelector('#open');
    const frame = modalRoot.querySelector('iframe');
    // The dashboard lives in an iframe, where the host's dark-theme attribute is
    // not visible, so the launcher reads it here and hands it over on open.
    const theme = () => document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
    const syncTheme = () => {
      const root = frame.contentDocument?.documentElement;
      if (root) root.dataset.theme = theme();
    };
    opener.addEventListener('click', () => {
      if (!frame.getAttribute('src')) frame.src = '/dsh-bill-visualization?theme=' + theme();
      else syncTheme();
      dialog.showModal();
    });
    modalRoot.querySelector('#close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (host.isConnected) opener.focus(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    frame.addEventListener('load', () => {
      syncTheme();
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
