// Client-side helpers shared by the two landowners-page forms
// (TakeHomeNote.astro and Contact.astro): fetching the anti-bot form token
// once per page, and loading + rendering the Cloudflare Turnstile widget.
//
// getFormToken() memoises its fetch, so however many forms call it, only one
// request to /api/form-token happens per page load.

let tokenPromise: Promise<string | null> | null = null;

export function getFormToken(): Promise<string | null> {
  if (!tokenPromise) {
    tokenPromise = fetch('/api/form-token')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data && typeof data.token === 'string' ? data.token : null))
      .catch(() => null);
  }
  return tokenPromise;
}

// Fills a form's hidden `form_token` input, if it has one.
export async function fillFormToken(form: HTMLFormElement | null): Promise<void> {
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>('input[name="form_token"]');
  if (!input) return;
  const token = await getFormToken();
  if (token) input.value = token;
}

type TurnstileApi = {
  render: (container: string, options: Record<string, unknown>) => string;
  reset: (widgetIdOrContainer?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let apiPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileApi(): Promise<TurnstileApi> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const callbackName = '__onTurnstileLoad';
    (window as unknown as Record<string, () => void>)[callbackName] = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile script loaded without exposing window.turnstile'));
    };
    const script = document.createElement('script');
    script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?onload=${callbackName}&render=explicit`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Turnstile script failed to load'));
    document.head.appendChild(script);
  });
  return apiPromise;
}

// Renders a Turnstile widget into the element with id `containerId`. A no-op
// if siteKey is empty (Turnstile isn't configured; the form still submits and
// the server decides), the container is missing, or a widget is already
// rendered there.
export async function renderTurnstile(containerId: string, siteKey: string | undefined): Promise<void> {
  if (!siteKey) return;
  const container = document.getElementById(containerId);
  if (!container || container.childElementCount > 0) return;
  try {
    const turnstile = await loadTurnstileApi();
    turnstile.render(`#${containerId}`, {
      sitekey: siteKey,
      size: 'flexible',
      theme: 'light',
      appearance: 'interaction-only',
    });
  } catch (err) {
    console.error('[form-client] Turnstile failed to load or render', err);
  }
}

// Resets a rendered widget so a retry after a failed submission gets a fresh
// challenge token rather than reusing one Cloudflare has already consumed.
export function resetTurnstile(containerId: string): void {
  try {
    window.turnstile?.reset(`#${containerId}`);
  } catch {
    // best effort only
  }
}

export interface PostFormResult {
  status: number;
  body: any;
}

// Serialises a form and POSTs it to its own action with fetch. Both
// landowners-page forms (Contact, TakeHomeNote) use this so their inline
// submit handlers share one fetch-and-parse path instead of each
// reimplementing it.
export async function postForm(form: HTMLFormElement): Promise<PostFormResult> {
  const action = form.getAttribute('action') || form.action;
  const formData = new FormData(form);
  const res = await fetch(action, { method: 'POST', body: formData });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// Fire-and-forget click tracking for the tel:/wa.me/mailto: links (Call,
// WhatsApp, Email). Uses navigator.sendBeacon where available, since it
// survives the page unloading straight after the tap; falls back to fetch
// with keepalive so the request still has a chance to land elsewhere.
export function sendClick(channel: 'call' | 'whatsapp' | 'email', ref?: string | null): void {
  try {
    const payload = JSON.stringify({ channel, ref: ref || undefined });
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/click', blob);
      return;
    }
    fetch('/api/click', {
      method: 'POST',
      body: payload,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    }).catch(() => {
      // best effort only
    });
  } catch {
    // best effort only
  }
}
