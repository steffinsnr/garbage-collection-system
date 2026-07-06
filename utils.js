'use strict';

const NSNR = {
  API_BASE: (() => {
    const { protocol, port, hostname } = window.location;
    if (protocol === 'file:' || (port && port !== '3000')) {
      return 'http://localhost:3000';
    }
    if (hostname === '127.0.0.1' && port === '5500') {
      return 'http://localhost:3000';
    }
    return '';
  })(),

  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  clearElement(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  },

  setText(el, text) {
    if (el) el.textContent = text == null ? '' : String(text);
  },

  createEl(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'colSpan') el.colSpan = value;
      else if (key === 'tabIndex') el.tabIndex = value;
      else if (/^aria[A-Z]/.test(key)) {
        const attr = 'aria-' + key.slice(4).replace(/([A-Z])/g, '-$1').toLowerCase();
        el.setAttribute(attr, value);
      } else if (['role', 'id', 'type', 'href', 'for', 'hidden'].includes(key)) {
        if (key === 'hidden') el.hidden = value === true || value === 'true';
        else el.setAttribute(key, value);
      } else if (key.startsWith('data')) {
        el.dataset[key.slice(4).toLowerCase()] = value;
      }
    });
    children.forEach(child => {
      if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else if (child) el.appendChild(child);
    });
    return el;
  },

  getToken(role) {
    return sessionStorage.getItem(`nsnr_token_${role}`);
  },

  setToken(role, token) {
    if (token) sessionStorage.setItem(`nsnr_token_${role}`, token);
    else sessionStorage.removeItem(`nsnr_token_${role}`);
  },

  getUser(role) {
    const raw = sessionStorage.getItem(`nsnr_user_${role}`);
    return raw ? JSON.parse(raw) : null;
  },

  setUser(role, user) {
    if (user) sessionStorage.setItem(`nsnr_user_${role}`, JSON.stringify(user));
    else sessionStorage.removeItem(`nsnr_user_${role}`);
  },

  async api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const role = options.role;
    if (role) {
      const token = NSNR.getToken(role);
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let res;
    try {
      res = await fetch(`${NSNR.API_BASE}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch {
      throw new Error(
        'Cannot reach the server. Run "npm start" in the project folder, then open http://localhost:3000'
      );
    }

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    }

    if (!res.ok) {
      let message = (data && data.error) || `Request failed (${res.status})`;
      if (res.status === 405 || res.status === 404) {
        message = 'Backend not available. Run "npm start" then use http://localhost:3000/collectors.html';
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  async checkServer() {
    try {
      await NSNR.api('/api/stats');
      return true;
    } catch {
      return false;
    }
  },

  showServerWarning(containerId) {
    NSNR.checkServer().then((ok) => {
      if (ok) return;
      const container = document.getElementById(containerId);
      if (!container || document.getElementById('server-warning')) return;
      const warn = NSNR.createEl('div', {
        id: 'server-warning',
        className: 'message error',
        role: 'alert',
        text: 'Server offline — open a terminal, run "npm start", then refresh this page.'
      });
      container.prepend(warn);
    });
  },

  showMessage(el, text, type = 'success') {
    if (!el) return;
    el.textContent = text;
    el.className = `message ${type}`;
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    setTimeout(() => {
      el.textContent = '';
      el.className = 'message';
      el.removeAttribute('role');
    }, type === 'error' ? 6000 : 5000);
  },

  announce(text) {
    let region = document.getElementById('sr-announcer');
    if (!region) {
      region = NSNR.createEl('div', {
        id: 'sr-announcer',
        className: 'sr-only',
        role: 'status',
        ariaLive: 'polite',
        ariaAtomic: 'true'
      });
      document.body.appendChild(region);
    }
    region.textContent = '';
    requestAnimationFrame(() => { region.textContent = text; });
  },

  trapFocus(modal) {
    const focusable = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return () => {};
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();

    function handler(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    modal.addEventListener('keydown', handler);
    return () => modal.removeEventListener('keydown', handler);
  },

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    modal._releaseFocus = NSNR.trapFocus(modal);
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    if (modal._releaseFocus) modal._releaseFocus();
  },

  statusClass(status) {
    return 'status-' + String(status).toLowerCase().replace(/\s+/g, '-');
  },

  priorityClass(priority) {
    return 'priority-' + String(priority).toLowerCase();
  },

  formatDate(iso, options = {}) {
    if (!iso) return 'Not specified';
    return new Date(iso).toLocaleDateString('en-KE', {
      timeZone: 'Africa/Nairobi',
      ...options
    });
  },

  connectRealtime(onUpdate) {
    if (typeof EventSource === 'undefined') return null;
    const base = NSNR.API_BASE || '';
    const es = new EventSource(`${base}/api/events`);
    es.addEventListener('data-changed', onUpdate);
    es.onerror = () => { /* browser auto-reconnects */ };
    return es;
  },

  validateRequestForm(data) {
    const errors = [];
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(data.residentId)) errors.push('Resident ID: 3–20 alphanumeric characters.');
    if (!/^[A-Za-z\s'.-]{2,100}$/.test(data.residentName)) errors.push('Full name: 2–100 letters only.');
    if (!data.wasteType) errors.push('Select a waste type.');
    if (!/^[+]?[0-9\s-]{9,15}$/.test(data.phone)) errors.push('Enter a valid phone number.');
    if (data.address.length < 5) errors.push('Address must be at least 5 characters.');
    return errors;
  },

  async loadDemoHints(containerId, role) {
    try {
      const hints = await NSNR.api('/api/config/demo-hints');
      const container = document.getElementById(containerId);
      if (!container || !hints.enabled) return;

      NSNR.clearElement(container);
      const heading = NSNR.createEl('h4', { text: 'Demo Credentials:' });
      container.appendChild(heading);

      if (role === 'admin') {
        container.appendChild(NSNR.createEl('p', {}, [
          NSNR.createEl('strong', { text: 'Username: ' }),
          document.createTextNode(hints.admin.username)
        ]));
        container.appendChild(NSNR.createEl('p', {}, [
          NSNR.createEl('strong', { text: 'Password: ' }),
          document.createTextNode(hints.admin.password)
        ]));
      } else {
        container.appendChild(NSNR.createEl('p', {}, [
          NSNR.createEl('strong', { text: 'IDs: ' }),
          document.createTextNode(hints.collectors.ids.join(', '))
        ]));
        container.appendChild(NSNR.createEl('p', {}, [
          NSNR.createEl('strong', { text: 'Password: ' }),
          document.createTextNode(hints.collectors.password)
        ]));
      }
    } catch {
      /* demo hints optional */
    }
  }
};

window.NSNR = NSNR;
