// src/ui/intro.js — general intro video transition, played between difficulty
// select and game start. Veo-generated clips in public/video/generals/<faction>.mp4
// (see scripts/gen-general-videos.mjs). Dialogue only — the menu music keeps
// playing underneath.
//
// playGeneralIntro(rootEl, factionKey) → Promise<void>
//   Resolves when the clip ends, the player skips (click / Esc / Enter / Space),
//   or the video can't load — so game start never blocks on a missing file.

const VIDEO_BASE = (import.meta.env?.BASE_URL || './') + 'video/generals/';

export function playGeneralIntro(rootEl, factionKey) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ic-intro-overlay';
    overlay.innerHTML = `
      <video class="ic-intro-video" playsinline></video>
      <div class="ic-intro-skip">Click or press ESC to skip</div>
    `;
    const video = overlay.querySelector('video');
    video.src = VIDEO_BASE + factionKey + '.mp4';

    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKey, true);
      clearTimeout(loadTimer);
      video.pause();
      overlay.classList.add('ic-intro-out');
      setTimeout(() => overlay.remove(), 250);
      resolve();
    }
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); finish();
      }
    }

    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    overlay.addEventListener('click', finish);
    window.addEventListener('keydown', onKey, true);
    // If the clip hasn't started within 4s (missing file, slow network), bail.
    const loadTimer = setTimeout(() => { if (video.readyState < 2) finish(); }, 4000);
    video.addEventListener('playing', () => clearTimeout(loadTimer));

    rootEl.appendChild(overlay);
    // Triggered from a click on the difficulty card, so audible autoplay is allowed;
    // if the browser still refuses, skip the intro rather than show a frozen frame.
    const p = video.play();
    if (p && p.catch) p.catch(() => finish());
  });
}
