// storage.js
// ------------------------------------------------------------
// Saves small things (scores and settings, NEVER audio) in this browser's
// localStorage, so they're still there next time. They stay on this device
// and are never sent anywhere.
//
// localStorage can be unavailable (private browsing, blocked site data) or
// full. Then nothing is saved, and the app carries on with defaults.
// ------------------------------------------------------------

export function loadJSON(key, fallback) {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to do
  }
}
