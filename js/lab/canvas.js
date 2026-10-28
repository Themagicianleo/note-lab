// canvas.js
// ------------------------------------------------------------
// Small helpers shared by the Lab's charts: a sharp canvas on retina
// screens, and colours taken from the glass.css theme (so charts follow
// light and dark mode).
// ------------------------------------------------------------

// Size the canvas for the screen's pixel density and return a context that
// draws in CSS pixels, plus the size in CSS pixels.
export function prepareCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
  if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  return { ctx, width, height };
}

// Theme colours (names from glass.css).
export function themeColours() {
  const css = getComputedStyle(document.documentElement);
  const get = (name) => css.getPropertyValue(name).trim();
  return {
    text: get('--fg'), muted: get('--muted'), grid: get('--line'), fill: get('--fill'),
    blue: get('--blue'), orange: get('--orange'), green: get('--green'), purple: get('--purple'), red: get('--red'),
  };
}
