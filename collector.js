'use strict';

class CollectorDashboard {
  constructor() {
    this.currentCollector = NSNR.getUser('collector');
    this.requests = [];
    this.schedules = [];
    this.init();
  }

  init() {
    this.setupEventListeners();
    if (this.currentCollector) this.showDashboard();
    NSNR.loadDemoHints('collectorCredentials', 'collector');
    NSNR.showServerWarning('loginSection');
    this.realtime = NSNR.connectRealtime(() => {
      if (this.currentCollector) this.refreshData();
    });
  }

  setupEventListeners() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', (e) => this.handleLogin(e));

    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    if (hamburger && navMenu) {
      hamburger.addEventListener('click', () => {
        const open = hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
        hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    const collectorId = document.getElementById('collectorId').value.trim();
    const password = document.getElementById('password').value;
    const msgEl = document.getElementById('loginMessage');

    try {
      const { token, user } = await NSNR.api('/api/auth/login', {
        method: 'POST',
        body: { username: collectorId, password, role: 'collector' }
      });
      NSNR.setToken('collector', token);
      NSNR.setUser('collector', user);
      this.currentCollector = user;
      NSNR.showMessage(msgEl, 'Login successful!', 'success');
      NSNR.announce('Collector login successful.');
      await this.showDashboard();
    } catch (err) {
      NSNR.showMessage(msgEl, err.message, 'error');
    }
  }

  async refreshData() {
    try {
      [this.requests, this.schedules] = await Promise.all([
        NSNR.api('/api/requests', { role: 'collector' }),
        NSNR.api('/api/schedules')
      ]);
      this.loadAssignedRequests();
      this.loadTodaySchedule();
      this.updateStats();
      this.updateProfile();
    } catch (err) {
      console.error(err);
    }
  }

  async showDashboard() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
    this.updateCollectorInfo();
    await this.refreshData();
  }

  updateCollectorInfo() {
    NSNR.setText(
      document.getElementById('collectorName'),
      this.currentCollector ? `Welcome, ${this.currentCollector.name}` : ''
    );
  }

  updateProfile() {
    if (!this.currentCollector) return;
    NSNR.setText(document.getElementById('profileName'), this.currentCollector.name);
    NSNR.setText(document.getElementById('profileId'), this.currentCollector.id || this.currentCollector.username);
    NSNR.setText(document.getElementById('profilePhone'), this.currentCollector.phone || '—');
    NSNR.setText(document.getElementById('profileArea'), this.currentCollector.area || '—');
  }

  loadAssignedRequests() {
    const grid = document.getElementById('assignedRequestsGrid');
    if (!grid || !this.currentCollector) return;
    NSNR.clearElement(grid);

    const id = this.currentCollector.id || this.currentCollector.username;
    const assigned = this.requests.filter(r => r.assignedCollector && r.assignedCollector.includes(id));

    if (!assigned.length) {
      grid.appendChild(NSNR.createEl('p', { text: 'No requests assigned to you yet.' }));
      return;
    }

    assigned.forEach(req => {
      const card = NSNR.createEl('div', {
        className: 'request-card',
        role: 'button',
        tabIndex: '0',
        ariaLabel: `Open request ${req.id}`
      });
      card.addEventListener('click', () => openRequestModal(req.id));
      card.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRequestModal(req.id); }
      });

      const header = NSNR.createEl('div', { className: 'request-header' });
      header.appendChild(NSNR.createEl('h4', { text: `Request #${req.id}` }));
      header.appendChild(NSNR.createEl('span', {
        className: `status-badge ${NSNR.statusClass(req.status)}`,
        text: req.status
      }));
      card.appendChild(header);

      const details = NSNR.createEl('div', { className: 'request-details' });
      [['Resident', req.residentName], ['Type', req.wasteType], ['Priority', req.priority], ['Address', req.address], ['Phone', req.phone]].forEach(([label, val]) => {
        const p = NSNR.createEl('p');
        p.appendChild(NSNR.createEl('strong', { text: `${label}: ` }));
        p.appendChild(document.createTextNode(val));
        details.appendChild(p);
      });
      card.appendChild(details);

      const actions = NSNR.createEl('div', { className: 'request-actions' });
      const startBtn = NSNR.createEl('button', { className: 'btn-primary btn-sm', type: 'button', text: ' Start' });
      startBtn.prepend(NSNR.createEl('i', { className: 'fas fa-play', ariaHidden: 'true' }));
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        updateRequestStatusDirect(req.id, 'In Progress');
      });

      const completeBtn = NSNR.createEl('button', { className: 'btn-secondary btn-sm', type: 'button', text: ' Complete' });
      completeBtn.prepend(NSNR.createEl('i', { className: 'fas fa-check', ariaHidden: 'true' }));
      completeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        updateRequestStatusDirect(req.id, 'Completed');
      });

      actions.appendChild(startBtn);
      actions.appendChild(completeBtn);
      card.appendChild(actions);
      grid.appendChild(card);
    });
  }

  loadTodaySchedule() {
    const grid = document.getElementById('todaySchedule');
    if (!grid || !this.currentCollector) return;
    NSNR.clearElement(grid);

    const today = new Date().toISOString().split('T')[0];
    const id = this.currentCollector.id || this.currentCollector.username;
    const todayItems = this.schedules.filter(s =>
      s.date === today && s.collector && s.collector.includes(id)
    );

    if (!todayItems.length) {
      grid.appendChild(NSNR.createEl('p', { text: 'No schedule for today.' }));
      return;
    }

    todayItems.forEach(schedule => {
      const card = NSNR.createEl('div', { className: 'schedule-card', role: 'article' });
      card.appendChild(NSNR.createEl('h4', { text: `${schedule.type} Collection` }));
      card.appendChild(NSNR.createEl('p', {}, [
        NSNR.createEl('strong', { text: 'Area: ' }),
        document.createTextNode(schedule.area)
      ]));
      card.appendChild(NSNR.createEl('p', {}, [
        NSNR.createEl('strong', { text: 'Time (EAT): ' }),
        document.createTextNode(schedule.time)
      ]));
      card.appendChild(NSNR.createEl('p', {}, [
        NSNR.createEl('strong', { text: 'Status: ' }),
        NSNR.createEl('span', { className: 'status-badge status-pending', text: 'Scheduled' })
      ]));
      grid.appendChild(card);
    });
  }

  updateStats() {
    if (!this.currentCollector) return;
    const id = this.currentCollector.id || this.currentCollector.username;
    const assigned = this.requests.filter(r => r.assignedCollector && r.assignedCollector.includes(id));
    const pending = assigned.filter(r => r.status === 'Pending' || r.status === 'In Progress');
    const today = new Date().toISOString().split('T')[0];
    const completedToday = assigned.filter(r => r.status === 'Completed' && r.collectionDate === today);

    NSNR.setText(document.getElementById('totalAssigned'), assigned.length);
    NSNR.setText(document.getElementById('pendingTasks'), pending.length);
    NSNR.setText(document.getElementById('completedToday'), completedToday.length);
  }
}

function logout() {
  NSNR.setToken('collector', null);
  NSNR.setUser('collector', null);
  location.reload();
}

function openRequestModal(requestId) {
  const request = window.collectorDashboard.requests.find(r => r.id === requestId);
  if (!request) return;

  const modal = document.getElementById('requestModal');
  NSNR.setText(document.getElementById('modalTitle'), `Request #${request.id}`);

  const body = document.getElementById('modalBody');
  NSNR.clearElement(body);

  const fields = [
    ['Resident', `${request.residentName} (${request.residentId})`],
    ['Waste Type', request.wasteType],
    ['Priority', request.priority],
    ['Address', request.address],
    ['Phone', request.phone],
    ['Description', request.description || 'No description provided'],
    ['Preferred Date', request.preferredDate ? NSNR.formatDate(request.preferredDate + 'T12:00:00') : 'Not specified'],
    ['Submitted', NSNR.formatDate(request.timestamp)]
  ];

  fields.forEach(([label, value]) => {
    const row = NSNR.createEl('div', { className: 'detail-row' });
    row.appendChild(NSNR.createEl('strong', { text: `${label}: ` }));
    if (label === 'Status') {
      row.appendChild(NSNR.createEl('span', {
        className: `status-badge ${NSNR.statusClass(request.status)}`,
        text: request.status
      }));
    } else {
      row.appendChild(document.createTextNode(value));
    }
    body.appendChild(row);
  });

  modal.dataset.requestId = requestId;
  NSNR.openModal('requestModal');
}

function closeModal() {
  NSNR.closeModal('requestModal');
}

async function updateRequestStatusDirect(requestId, status) {
  try {
    await NSNR.api(`/api/requests/${requestId}`, {
      method: 'PATCH',
      role: 'collector',
      body: { status }
    });
    await window.collectorDashboard.refreshData();
    NSNR.announce(`Request marked ${status.toLowerCase()}.`);
    const msgEl = document.getElementById('loginMessage');
    if (msgEl) NSNR.showMessage(msgEl, `Request ${status.toLowerCase()} successfully!`, 'success');
  } catch (err) {
    alert(err.message);
  }
}

function updateRequestStatus(status) {
  const modal = document.getElementById('requestModal');
  const requestId = modal?.dataset.requestId;
  if (!requestId) return;
  updateRequestStatusDirect(requestId, status);
  closeModal();
}

function startRoute() {
  alert('Route started! GPS tracking enabled.');
  NSNR.announce('Route started.');
}

function reportIssue() {
  const issue = prompt('Please describe the issue:');
  if (issue) {
    alert('Issue reported successfully!');
    NSNR.announce('Issue reported.');
  }
}

function updateLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => alert(`Location updated: ${pos.coords.latitude}, ${pos.coords.longitude}`),
    () => alert('Unable to get location. Please check your browser permissions.')
  );
}

function toggleHint() {
  const credentialsDiv = document.getElementById('collectorCredentials');
  const hintLink = document.getElementById('hintLink');
  if (!credentialsDiv || !hintLink) return;
  const show = credentialsDiv.hidden;
  credentialsDiv.hidden = !show;
  hintLink.textContent = show ? 'Hide Hint' : 'Hint';
  hintLink.setAttribute('aria-expanded', show ? 'true' : 'false');
}

function showDashboardSection() {
  if (window.collectorDashboard?.currentCollector) {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
  } else {
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('dashboardSection').style.display = 'none';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToSection(sectionId) {
  if (window.collectorDashboard?.currentCollector) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
  } else {
    showDashboardSection();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.collectorDashboard = new CollectorDashboard();
});
