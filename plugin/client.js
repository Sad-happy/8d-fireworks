// dsh-fireworks client controller — injects the full-screen fireworks iframe,
// a translucent shell (glass) and the settings button/panel into the DSH page.
// Panel styling and glass approach adapted from open-sea-skin (MIT), with the
// light-theme dialog fix baked in: our dialog-protection rule excludes our own
// panel, and the panel background carries !important.
window.__ModuleLoader__.load({ id: "dsh-fireworks", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;

  const IDS = Object.freeze({
    frame: '__dsh-fireworks__',
    glass: '__dsh-fireworks-glass__',
    uiStyle: '__dsh-fireworks-glass__-ui',
    button: '__dsh-fireworks-btn__',
    panel: '__dsh-fireworks-panel__',
  });

  const KEYS = Object.freeze({
    enabled: 'fwEnabled',
    glass: 'fwGlass',
    density: 'fwDensity',
  });

  const DEFAULTS = Object.freeze({ enabled: true, glass: 55, density: 100 });

  const COPY = Object.freeze({
    zh: {
      button: '烟花设置',
      close: '关闭',
      glass: '玻璃不透明度',
      density: '烟花密度',
      enable: '启用烟花背景',
      reset: '恢复默认',
      resetNote: '恢复全部默认设置（玻璃 55 / 密度 100 / 启用）',
      note: '调节即时生效并自动保存；烟花对耳机里播放的声音起舞。',
    },
    en: {
      button: 'Fireworks settings',
      close: 'Close',
      glass: 'Glass opacity',
      density: 'Firework density',
      enable: 'Enable fireworks background',
      reset: 'Reset to defaults',
      resetNote: 'Restore all defaults (glass 55 / density 100 / enabled)',
      note: 'Changes apply immediately and save automatically. Fireworks dance to the sound playing on your headphones.',
    },
  });

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }
  function normalize(raw) {
    return {
      enabled: raw.enabled !== false,
      glass: clamp(raw.glass, 40, 90, DEFAULTS.glass),
      density: clamp(raw.density, 50, 150, DEFAULTS.density),
    };
  }
  function readSetting(key, fallback) {
    try {
      const value = localStorage.getItem(KEYS[key]);
      if (value === null) return fallback;
      if (key === 'enabled') return value !== 'false';
      return Number(value);
    } catch { return fallback; }
  }
  function selectCopy() {
    const lang = document.documentElement.lang || navigator.language || 'en';
    return String(lang).toLowerCase().startsWith('zh') ? COPY.zh : COPY.en;
  }

  const SPARK_ICON = `
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M3.4 3.4l1.8 1.8M10.8 10.8l1.8 1.8M12.6 3.4l-1.8 1.8M5.2 10.8l-1.8 1.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>
  <circle cx="8" cy="8" r="1.6" fill="currentColor" opacity="0.9"/>
</svg>`;

  function glassCss(glass, dark) {
    const a = Number((glass / 100).toFixed(2));
    const c = dark
      ? { base: '10, 14, 22', l1: '12, 16, 25', l2: '16, 20, 30', l3: '20, 25, 35', ov: '12, 16, 25' }
      : { base: '255, 255, 255', l1: '250, 250, 252', l2: '245, 246, 250', l3: '240, 241, 246', ov: '250, 251, 253' };
    return `
/* dsh-fireworks: translucent shell (${dark ? 'dark' : 'light'} theme); fireworks shine through. */
body {
  background: transparent !important;
  --dsw-alias-bg-base: rgba(${c.base}, ${a}) !important;
  --dsw-alias-bg-layer-1: rgba(${c.l1}, ${a}) !important;
  --dsw-alias-bg-layer-2: rgba(${c.l2}, ${a}) !important;
  --dsw-alias-bg-layer-3: rgba(${c.l3}, ${a}) !important;
  --dsw-alias-bg-module-platform: rgba(${c.l1}, ${a}) !important;
  --dsw-alias-bg-multi-select: rgba(${c.l1}, ${a}) !important;
  --dsw-alias-bg-overlay: rgba(${c.ov}, .96) !important;
  --dsw-specific-sidebar-fill: rgba(${c.base}, ${Math.max(0.36, a - 0.04)}) !important;
  --dsw-specific-selector: rgba(${c.l1}, ${a}) !important;
}
body:is([data-dsh-desktop-mode="advanced"], [data-dsh-desktop-mode="extended"]) .dshDesktopFrame {
  background: var(--dsw-alias-bg-base) !important;
}
body:is([data-dsh-desktop-mode="advanced"], [data-dsh-desktop-mode="extended"]) .dshDesktopSidebarSurface {
  --dsw-specific-sidebar-fill: transparent !important;
}
body:is([data-dsh-desktop-mode="advanced"], [data-dsh-desktop-mode="extended"]) :is(
  .dshDesktopSidebarSurface,
  .dshDesktopConversationSurface,
  .dshDesktopDetailsSurface,
  .dshDesktopMacCaptionRow,
  .dshDesktopWindowsCaptionRow,
  .dshDesktopConversationSurface > *,
  .dshDesktopConversationSurface [data-phase="hero"],
  .dshDesktopConversationSurface [data-phase="active"],
  .dshDesktopConversationSurface [data-phase="settling"],
  .dshDesktopDetailsSurface > *
) {
  background: transparent !important;
}
html:is([data-platform="darwin"], [data-windows-titlebar]) body #root div:has(> [data-shell-overlay]) {
  background: var(--dsw-alias-bg-base) !important;
}
html:is([data-platform="darwin"], [data-windows-titlebar]) body #root div:has(> [data-shell-overlay]) > :is(:first-child, :nth-child(2), [data-rightbar-col]),
html:is([data-platform="darwin"], [data-windows-titlebar]) body #root div:has(> [data-shell-overlay]) > :nth-child(2) [data-phase],
html:is([data-platform="darwin"], [data-windows-titlebar]) body #root [data-rightbar-col] [data-dockkit-host="dock"] > [data-dockkit-content] {
  background: transparent !important;
}
/* Modal protection — with OUR panel excluded, and glass style kept off it. */
body :is([data-shortcut-modal="settings"], [role="dialog"], [role="alertdialog"]):not(#${IDS.panel}) {
  background: rgba(250, 251, 253, .97) !important;
}
body[data-ds-dark-theme] :is([data-shortcut-modal="settings"], [role="dialog"], [role="alertdialog"]):not(#${IDS.panel}) {
  background: rgba(24, 28, 35, .97) !important;
}`;
  }

  function uiCss() {
    return `
#${IDS.button} {
  position: fixed; z-index: 6000; width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; border: 1px solid rgba(255,255,255,.14);
  background: rgba(12,16,22,.58); backdrop-filter: blur(14px) saturate(130%);
  color: #ffd9a0; cursor: pointer; padding: 0;
  transition: color .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease, transform .1s ease;
}
#${IDS.button}:hover { color:#ffe9c4; border-color:rgba(255,217,160,.5); background:rgba(20,16,10,.72); }
#${IDS.button}.active { color:#fff3da; border-color:rgba(255,217,160,.55); background:rgba(255,217,160,.14); box-shadow:0 0 14px rgba(255,200,120,.25); }
#${IDS.button}:active { transform:scale(.94); }
#${IDS.button}:focus-visible, #${IDS.panel} button:focus-visible, #${IDS.panel} input:focus-visible { outline:2px solid rgba(255,217,160,.7); outline-offset:2px; }
#${IDS.panel} {
  position:fixed; z-index:6001; width:250px; padding:16px;
  border-radius:16px; border:1px solid rgba(255,255,255,.14);
  background:rgba(10,14,20,.82) !important; backdrop-filter:blur(22px) saturate(140%);
  box-shadow:0 18px 50px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.1);
  color:#eef4f6; font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  display:none;
}
#${IDS.panel}.open { display:block; }
#${IDS.panel} .fw-title { display:flex; align-items:center; justify-content:space-between; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:rgba(255,255,255,.6); margin-bottom:14px; }
#${IDS.panel} .fw-mark, #${IDS.panel} .fw-value { color:#ffd9a0; }
#${IDS.panel} .fw-close { background:none; border:0; color:rgba(255,255,255,.55); font-size:18px; line-height:1; cursor:pointer; padding:3px 6px; border-radius:6px; }
#${IDS.panel} .fw-close:hover { color:#fff; background:rgba(255,255,255,.08); }
#${IDS.panel} .fw-row { margin-top:13px; }
#${IDS.panel} .fw-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:9px; font-size:11px; letter-spacing:.1em; color:rgba(255,255,255,.7); }
#${IDS.panel} .fw-value { font-variant-numeric:tabular-nums; }
#${IDS.panel} input[type='range'] { appearance:none; display:block; width:100%; height:14px; margin:0; padding:0; background:transparent; cursor:pointer; }
#${IDS.panel} input[type='range']::-webkit-slider-runnable-track { height:3px; border-radius:2px; background:rgba(255,255,255,.2); }
#${IDS.panel} input[type='range']::-webkit-slider-thumb { appearance:none; width:14px; height:14px; margin-top:-5.5px; border-radius:50%; background:#ffd9a0; border:0; box-shadow:0 0 8px rgba(255,217,160,.4); }
#${IDS.panel} .fw-switch { display:flex; align-items:center; justify-content:space-between; gap:10px; }
#${IDS.panel} .fw-switch label { font-size:12px; color:rgba(255,255,255,.85); cursor:pointer; }
#${IDS.panel} input[type='checkbox'] { appearance:none; width:34px; height:19px; border-radius:10px; background:rgba(255,255,255,.16); position:relative; cursor:pointer; transition:background .18s ease; margin:0; }
#${IDS.panel} input[type='checkbox']:checked { background:rgba(255,217,160,.55); }
#${IDS.panel} input[type='checkbox']::after { content:''; position:absolute; top:2px; left:2px; width:15px; height:15px; border-radius:50%; background:#fff; transition:left .18s ease; }
#${IDS.panel} input[type='checkbox']:checked::after { left:17px; }
#${IDS.panel} .fw-reset { display:block; width:100%; margin-top:15px; padding:7px 0; border-radius:9px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.05); color:rgba(255,255,255,.8); font-size:12px; cursor:pointer; }
#${IDS.panel} .fw-reset:hover { background:rgba(255,255,255,.10); color:#fff; }
#${IDS.panel} .fw-note { margin:11px 0 0; font-size:10.5px; line-height:1.7; color:rgba(255,255,255,.42); }`;
  }

  function createController(options) {
    let state = { ...DEFAULTS };
    const copy = selectCopy();
    let ownsSurface = false;
    let panelOpen = false;
    let previousFocus = null;
    let placementFrame = 0;
    let placementObserver = null;
    let themeObserver = null;
    const surfaceCleanups = [];
    const controllerCleanups = [];

    const save = (patch) => {
      state = normalize({ ...state, ...patch });
      Promise.resolve(options.storage.set(patch)).catch((error) => {
        console.warn('[dsh-fireworks] Failed to save settings.', error);
      });
    };

    const seaOwnsGlass = () => !!document.getElementById('__open-sea-skin-glass__');
    const isDarkTheme = () => !!(document.body && document.body.hasAttribute('data-ds-dark-theme'));
    const updateGlass = () => {
      const style = document.getElementById(IDS.glass);
      if (seaOwnsGlass()) {
        // open-sea-skin owns the shell tint. Two !important layers writing the
        // same --dsw-alias-* variables stack into mud (our dark glass painted
        // over its light one -> whole app went dark in light theme). Defer.
        if (style) style.remove();
        return;
      }
      if (style) style.textContent = glassCss(state.glass, isDarkTheme());
    };

    const postToFrame = () => {
      const frame = document.getElementById(IDS.frame);
      if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) return;
      let targetOrigin = '*';
      try { targetOrigin = new URL(frame.src).origin; } catch { /* keep '*' */ }
      frame.contentWindow.postMessage({ type: 'fw-set', density: state.density }, targetOrigin);
    };

    const placeButton = () => {
      const button = document.getElementById(IDS.button);
      if (!(button instanceof HTMLElement)) return;
      const seaButton = document.getElementById('__open-sea-skin-btn__');
      if (seaButton instanceof HTMLElement && seaButton.getBoundingClientRect().width > 0) {
        const rect = seaButton.getBoundingClientRect();
        button.style.left = `${Math.round(rect.left - 42)}px`;
        button.style.top = `${Math.round(rect.top)}px`;
        button.style.bottom = 'auto';
        return;
      }
      const selectors = [
        '[data-slot="sidebar.settings"] button',
        '[data-testid="settings-trigger"]',
        '.VOzbGW_trigger',
      ];
      const trigger = selectors.map((s) => document.querySelector(s))
        .find((c) => c instanceof HTMLElement && c.getBoundingClientRect().width > 0);
      if (trigger instanceof HTMLElement) {
        const rect = trigger.getBoundingClientRect();
        button.style.left = `${Math.round(rect.right + 8)}px`;
        button.style.top = `${Math.round(rect.top + rect.height / 2 - 17)}px`;
        button.style.bottom = 'auto';
      } else {
        button.style.left = '16px';
        button.style.bottom = '16px';
        button.style.top = 'auto';
      }
    };
    const schedulePlace = () => {
      cancelAnimationFrame(placementFrame);
      placementFrame = requestAnimationFrame(placeButton);
    };

    const setPanelOpen = (open) => {
      const button = document.getElementById(IDS.button);
      const panel = document.getElementById(IDS.panel);
      if (!(button instanceof HTMLButtonElement) || !(panel instanceof HTMLElement)) return;
      panelOpen = open;
      panel.classList.toggle('open', open);
      button.classList.toggle('active', open);
      button.setAttribute('aria-expanded', String(open));
      if (open) {
        previousFocus = document.activeElement;
        const rect = button.getBoundingClientRect();
        panel.style.left = `${Math.min(Math.max(12, rect.left - panel.offsetWidth + 34), window.innerWidth - panel.offsetWidth - 12)}px`;
        panel.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 10)}px`;
        panel.querySelector('input')?.focus();
      } else if (previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    };

    const mountFrame = () => {
      const root = document.body || document.documentElement;
      if (!root || document.getElementById(IDS.frame)) return false;
      const frame = document.createElement('iframe');
      frame.id = IDS.frame;
      frame.src = `${options.assetUrl('fireworks.html')}?density=${state.density}`;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:0;pointer-events:none;background:transparent;';
      // Both background layers use z-index:0 and paint in DOM order. Insert
      // after the open-sea-skin iframe (same trick: first-child) so fireworks
      // stacks above the ocean but still below the app UI. Without this,
      // whichever plugin mounts last covers the other.
      const seaFrame = document.getElementById('__open-sea-skin__');
      if (seaFrame && seaFrame.parentNode === root) {
        seaFrame.after(frame);
      } else {
        root.insertBefore(frame, root.firstChild);
      }
      updateGlass(); // no-op while open-sea-skin owns the shell tint
      ownsSurface = true;
      return true;
    };

    const mountUi = () => {
      if (document.getElementById(IDS.button)) return;
      const style = document.createElement('style');
      style.id = IDS.uiStyle;
      style.textContent = uiCss();
      (document.head || document.documentElement).appendChild(style);

      const button = document.createElement('button');
      button.id = IDS.button;
      button.type = 'button';
      button.title = copy.button;
      button.setAttribute('aria-label', copy.button);
      button.setAttribute('aria-controls', IDS.panel);
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = SPARK_ICON;

      const panel = document.createElement('div');
      panel.id = IDS.panel;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'false');
      panel.setAttribute('aria-label', copy.button);
      panel.innerHTML = `
        <div class="fw-title"><span>DSH <span class="fw-mark">·</span> FIREWORKS</span><button class="fw-close" type="button" aria-label="${copy.close}">×</button></div>
        <div class="fw-row"><div class="fw-head"><label for="${IDS.panel}-glass-range">${copy.glass}</label><output class="fw-value" id="${IDS.panel}-glass" for="${IDS.panel}-glass-range"></output></div><input type="range" id="${IDS.panel}-glass-range" min="40" max="90" step="1" /></div>
        <div class="fw-row"><div class="fw-head"><label for="${IDS.panel}-density-range">${copy.density}</label><output class="fw-value" id="${IDS.panel}-density" for="${IDS.panel}-density-range"></output></div><input type="range" id="${IDS.panel}-density-range" min="50" max="150" step="5" /></div>
        <div class="fw-row fw-switch"><label for="${IDS.panel}-enabled">${copy.enable}</label><input type="checkbox" id="${IDS.panel}-enabled" /></div>
        <button type="button" class="fw-reset">${copy.reset}</button>
        <p class="fw-note">${copy.resetNote}<br>${copy.note}</p>`;

      const host = document.body || document.documentElement;
      host.append(button, panel);

      const glassRange = panel.querySelector(`#${IDS.panel}-glass-range`);
      const densityRange = panel.querySelector(`#${IDS.panel}-density-range`);
      const glassOut = panel.querySelector(`#${IDS.panel}-glass`);
      const densityOut = panel.querySelector(`#${IDS.panel}-density`);
      const enableBox = panel.querySelector(`#${IDS.panel}-enabled`);

      const refresh = () => {
        glassRange.value = String(state.glass);
        densityRange.value = String(state.density);
        glassOut.textContent = String(state.glass);
        densityOut.textContent = String(state.density);
        enableBox.checked = state.enabled;
      };
      refresh();

      glassRange.addEventListener('input', () => { save({ glass: Number(glassRange.value) }); refresh(); updateGlass(); });
      densityRange.addEventListener('input', () => { save({ density: Number(densityRange.value) }); refresh(); postToFrame(); });
      enableBox.addEventListener('change', () => { save({ enabled: enableBox.checked }); applyEnabled(); });
      panel.querySelector('.fw-close').addEventListener('click', () => setPanelOpen(false));
      panel.querySelector('.fw-reset').addEventListener('click', () => {
        save({ ...DEFAULTS }); refresh(); updateGlass(); postToFrame(); applyEnabled();
      });
      button.addEventListener('click', () => setPanelOpen(!panelOpen));
      const onKey = (e) => { if (e.key === 'Escape' && panelOpen) setPanelOpen(false); };
      window.addEventListener('keydown', onKey);
      surfaceCleanups.push(() => window.removeEventListener('keydown', onKey));

      placementObserver = new MutationObserver(schedulePlace);
      placementObserver.observe(host, { childList: true, subtree: true });
      schedulePlace();

      // theme flips (and sea mounting/unmounting its glass) re-evaluate who
      // owns the shell tint and which palette our fallback glass uses
      themeObserver = new MutationObserver(updateGlass);
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-ds-dark-theme', 'class', 'data-dsh-desktop-mode'],
      });
    };

    const unmount = () => {
      panelOpen = false;
      placementObserver?.disconnect();
      placementObserver = null;
      themeObserver?.disconnect();
      themeObserver = null;
      cancelAnimationFrame(placementFrame);
      while (surfaceCleanups.length > 0) surfaceCleanups.pop()();
      if (ownsSurface) {
        document.getElementById(IDS.frame)?.remove();
        document.getElementById(IDS.glass)?.remove();
        ownsSurface = false;
      }
      document.getElementById(IDS.button)?.remove();
      document.getElementById(IDS.panel)?.remove();
      document.getElementById(IDS.uiStyle)?.remove();
    };

    const applyEnabled = () => {
      if (!document.getElementById(IDS.button)) mountUi();
      if (!state.enabled) {
        if (ownsSurface) {
          document.getElementById(IDS.frame)?.remove();
          document.getElementById(IDS.glass)?.remove();
          ownsSurface = false;
        }
        return;
      }
      if (document.getElementById(IDS.frame)) { postToFrame(); return; }
      if (mountFrame()) postToFrame();
    };

    const ready = () => new Promise((resolve) => {
      if (document.body) { resolve(); return; }
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });

    const start = async () => {
      await ready();
      try {
        state = normalize({
          enabled: readSetting('enabled', DEFAULTS.enabled),
          glass: readSetting('glass', DEFAULTS.glass),
          density: readSetting('density', DEFAULTS.density),
        });
      } catch (error) {
        console.warn('[dsh-fireworks] Failed to load settings; using defaults.', error);
      }
      applyEnabled();
    };

    const stop = () => {
      unmount();
      while (controllerCleanups.length > 0) controllerCleanups.pop()();
    };

    return Object.freeze({ start, stop, getState: () => ({ ...state }) });
  }

  exports.name = 'dsh-fireworks-client';
  exports.inject = [];
  exports.apply = function apply(ctx) {
    const controller = createController({
      assetUrl: (path) => '/dsh-fireworks/' + path,
      storage: {
        get: async () => ({
          enabled: readSetting('enabled', DEFAULTS.enabled),
          glass: readSetting('glass', DEFAULTS.glass),
          density: readSetting('density', DEFAULTS.density),
        }),
        set: async (patch) => {
          try {
            for (const [key, value] of Object.entries(patch)) {
              localStorage.setItem(KEYS[key], String(value));
            }
          } catch { /* keep live values */ }
        },
      },
    });
    void controller.start();
    ctx.effect(() => () => controller.stop(), 'dsh-fireworks: browser surface');
  };

  return module.exports;
}});
