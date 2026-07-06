'use strict';

class AdminDashboard {
  constructor() {
    this.currentAdmin = NSNR.getUser('admin');
    this.requests = [];
    this.collectors = [];
    this.schedules = [];
    this.init();
  }

  init() {
    this.setupEventListeners();
    if (this.currentAdmin) this.showDashboard();
    NSNR.loadDemoHints('adminCredentials', 'admin');
    NSNR.showServerWarning('loginSection');
    this.realtime = NSNR.connectRealtime(() => {
      if (this.currentAdmin) this.refreshData();
    });
  }

  setupEventListeners() {
    const form = document.getElementById('adminLoginForm');
    if (form) form.addEventListener('submit', (e) => this.handleAdminLogin(e));

    const addForm = document.getElementById('addCollectorForm');
    if (addForm) {
      addForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveNewCollector();
      });
    }

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

  async handleAdminLogin(e) {
    e.preventDefault();
    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value;
    const msgEl = document.getElementById('adminLoginMessage');

    try {
      const { token, user } = await NSNR.api('/api/auth/login', {
        method: 'POST',
        body: { username, password, role: 'admin' }
      });
      NSNR.setToken('admin', token);
      NSNR.setUser('admin', user);
      this.currentAdmin = user;
      NSNR.showMessage(msgEl, 'Login successful!', 'success');
      NSNR.announce('Admin login successful.');
      await this.showDashboard();
    } catch (err) {
      NSNR.showMessage(msgEl, err.message, 'error');
    }
  }

  async refreshData() {
    try {
      [this.requests, this.collectors, this.schedules] = await Promise.all([
        NSNR.api('/api/requests', { role: 'admin' }),
        NSNR.api('/api/collectors'),
        NSNR.api('/api/schedules')
      ]);
      this.loadRecentRequests();
      this.loadCollectors();
      this.loadScheduleAdminView();
      await this.updateStats();
    } catch (err) {
      console.error(err);
    }
  }

  async showDashboard() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
    this.updateAdminInfo();
    await this.refreshData();
  }

  updateAdminInfo() {
    NSNR.setText(document.getElementById('adminName'), this.currentAdmin ? `Welcome, ${this.currentAdmin.name}` : '');
  }

  loadRecentRequests() {
    const tableBody = document.getElementById('recentRequestsTable');
    if (!tableBody) return;
    NSNR.clearElement(tableBody);

    const recent = [...this.requests]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);

    if (!recent.length) {
      const row = NSNR.createEl('tr');
      const cell = NSNR.createEl('td', { colSpan: '7', text: 'No requests found' });
      row.appendChild(cell);
      tableBody.appendChild(row);
      return;
    }

    recent.forEach(req => {
      const row = NSNR.createEl('tr');
      [req.id, req.residentName, req.wasteType].forEach(val => {
        row.appendChild(NSNR.createEl('td', { text: val }));
      });

      const priTd = NSNR.createEl('td');
      priTd.appendChild(NSNR.createEl('span', {
        className: `priority-badge ${NSNR.priorityClass(req.priority)}`,
        text: req.priority
      }));
      row.appendChild(priTd);

      const statusTd = NSNR.createEl('td');
      statusTd.appendChild(NSNR.createEl('span', {
        className: `status-badge ${NSNR.statusClass(req.status)}`,
        text: req.status
      }));
      row.appendChild(statusTd);

      row.appendChild(NSNR.createEl('td', { text: NSNR.formatDate(req.timestamp) }));

      const actionsTd = NSNR.createEl('td');
      const viewBtn = NSNR.createEl('button', {
        className: 'btn-sm btn-primary',
        type: 'button',
        ariaLabel: `View request ${req.id}`
      });
      viewBtn.appendChild(NSNR.createEl('i', { className: 'fas fa-eye', ariaHidden: 'true' }));
      viewBtn.addEventListener('click', () => viewRequestDetails(req.id));

      const assignBtn = NSNR.createEl('button', {
        className: 'btn-sm btn-secondary',
        type: 'button',
        ariaLabel: `Assign request ${req.id}`
      });
      assignBtn.appendChild(NSNR.createEl('i', { className: 'fas fa-user-plus', ariaHidden: 'true' }));
      assignBtn.addEventListener('click', () => assignRequest(req.id));

      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(document.createTextNode(' '));
      actionsTd.appendChild(assignBtn);
      row.appendChild(actionsTd);
      tableBody.appendChild(row);
    });
  }

  loadCollectors() {
    const grid = document.getElementById('collectorsGrid');
    if (!grid) return;
    NSNR.clearElement(grid);
    this.updateCollectorDropdown();

    if (!this.collectors.length) {
      grid.appendChild(NSNR.createEl('p', { text: 'No collectors found' }));
      return;
    }

    this.collectors.forEach(collector => {
      const card = NSNR.createEl('div', { className: 'collector-card', role: 'article' });
      const header = NSNR.createEl('div', { className: 'collector-header' });
      header.appendChild(NSNR.createEl('h4', { text: collector.name }));
      header.appendChild(NSNR.createEl('span', {
        className: `status-badge status-${collector.status.toLowerCase()}`,
        text: collector.status
      }));
      card.appendChild(header);

      const details = NSNR.createEl('div', { className: 'collector-details' });
      [['ID', collector.id], ['Phone', collector.phone], ['Area', collector.area]].forEach(([label, val]) => {
        const p = NSNR.createEl('p');
        p.appendChild(NSNR.createEl('strong', { text: `${label}: ` }));
        p.appendChild(document.createTextNode(val));
        details.appendChild(p);
      });
      card.appendChild(details);

      const actions = NSNR.createEl('div', { className: 'collector-actions' });
      const editBtn = NSNR.createEl('button', { className: 'btn-sm btn-primary', type: 'button', text: ' Edit' });
      editBtn.prepend(NSNR.createEl('i', { className: 'fas fa-edit', ariaHidden: 'true' }));
      editBtn.addEventListener('click', () => editCollector(collector.id));

      const delBtn = NSNR.createEl('button', { className: 'btn-sm btn-secondary', type: 'button', text: ' Delete' });
      delBtn.prepend(NSNR.createEl('i', { className: 'fas fa-trash', ariaHidden: 'true' }));
      delBtn.addEventListener('click', () => deleteCollector(collector.id));

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      grid.appendChild(card);
    });
  }

  updateCollectorDropdown() {
    const dropdown = document.getElementById('scheduleCollector');
    if (!dropdown) return;
    const current = dropdown.value;
    NSNR.clearElement(dropdown);
    dropdown.appendChild(NSNR.createEl('option', { value: '', text: 'Select Collector' }));
    this.collectors.forEach(c => {
      const val = `${c.name} (${c.id})`;
      dropdown.appendChild(NSNR.createEl('option', { value: val, text: val }));
    });
    if (current && [...dropdown.options].some(o => o.value === current)) dropdown.value = current;
  }

  async updateStats() {
    try {
      const stats = await NSNR.api('/api/stats');
      NSNR.setText(document.getElementById('totalRequests'), stats.totalRequests);
      NSNR.setText(document.getElementById('pendingRequests'), stats.pendingRequests);
      NSNR.setText(document.getElementById('completedRequests'), stats.completedRequests);
      NSNR.setText(document.getElementById('activeCollectors'), stats.activeCollectors);
    } catch (err) {
      console.error(err);
    }
  }

  loadScheduleAdminView() {
    const tableBody = document.getElementById('adminScheduleTable');
    if (!tableBody) return;
    NSNR.clearElement(tableBody);

    if (!this.schedules.length) {
      const row = NSNR.createEl('tr');
      row.appendChild(NSNR.createEl('td', {
        colSpan: '7',
        text: 'No schedule entries yet. Use the form above to add one.'
      }));
      tableBody.appendChild(row);
      return;
    }

    this.schedules.forEach((s, index) => {
      const row = NSNR.createEl('tr');
      [s.date, s.dayName, s.area, s.type, s.time, s.collector || '-'].forEach(val => {
        row.appendChild(NSNR.createEl('td', { text: val }));
      });
      const actionsTd = NSNR.createEl('td');
      const editBtn = NSNR.createEl('button', { className: 'btn-sm btn-primary', type: 'button', ariaLabel: 'Edit schedule' });
      editBtn.appendChild(NSNR.createEl('i', { className: 'fas fa-edit', ariaHidden: 'true' }));
      editBtn.addEventListener('click', () => editScheduleAdmin(index));

      const delBtn = NSNR.createEl('button', { className: 'btn-sm btn-secondary', type: 'button', ariaLabel: 'Delete schedule' });
      delBtn.appendChild(NSNR.createEl('i', { className: 'fas fa-trash', ariaHidden: 'true' }));
      delBtn.addEventListener('click', () => deleteScheduleAdmin(index));

      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(document.createTextNode(' '));
      actionsTd.appendChild(delBtn);
      row.appendChild(actionsTd);
      tableBody.appendChild(row);
    });
  }
}

function logout() {
  NSNR.setToken('admin', null);
  NSNR.setUser('admin', null);
  location.reload();
}

async function assignRequests() {
  try {
    const result = await NSNR.api('/api/requests/assign-bulk', { method: 'POST', role: 'admin' });
    await window.adminDashboard.refreshData();
    alert(`Assigned ${result.assigned} requests to collectors.`);
    NSNR.announce(`${result.assigned} requests assigned.`);
  } catch (err) {
    alert(err.message);
  }
}

function addCollector() {
  NSNR.openModal('addCollectorModal');
}

function closeAddCollectorModal() {
  NSNR.closeModal('addCollectorModal');
  document.getElementById('addCollectorForm')?.reset();
}

async function saveNewCollector() {
  const body = {
    name: document.getElementById('newCollectorName').value.trim(),
    phone: document.getElementById('newCollectorPhone').value.trim(),
    area: document.getElementById('newCollectorArea').value,
    status: document.getElementById('newCollectorStatus').value
  };

  try {
    await NSNR.api('/api/collectors', { method: 'POST', role: 'admin', body });
    await window.adminDashboard.refreshData();
    closeAddCollectorModal();
    alert('Collector added successfully!');
    NSNR.announce('Collector added.');
  } catch (err) {
    alert(err.message);
  }
}

async function editCollector(collectorId) {
  const collector = window.adminDashboard.collectors.find(c => c.id === collectorId);
  if (!collector) return;
  const newName = prompt('Enter new name:', collector.name);
  if (!newName || !newName.trim()) return;

  try {
    await NSNR.api(`/api/collectors/${collectorId}`, {
      method: 'PUT',
      role: 'admin',
      body: { ...collector, name: newName.trim() }
    });
    await window.adminDashboard.refreshData();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteCollector(collectorId) {
  if (!confirm('Are you sure you want to delete this collector?')) return;
  try {
    await NSNR.api(`/api/collectors/${collectorId}`, { method: 'DELETE', role: 'admin' });
    await window.adminDashboard.refreshData();
    alert('Collector deleted successfully!');
  } catch (err) {
    alert(err.message);
  }
}

function viewRequestDetails(requestId) {
  const request = window.adminDashboard.requests.find(r => r.id === requestId);
  if (!request) return;
  const lines = [
    `Request ID: ${request.id}`,
    `Resident: ${request.residentName} (${request.residentId})`,
    `Waste Type: ${request.wasteType}`,
    `Priority: ${request.priority}`,
    `Address: ${request.address}`,
    `Phone: ${request.phone}`,
    `Description: ${request.description || 'No description'}`,
    `Status: ${request.status}`,
    `Submitted: ${NSNR.formatDate(request.timestamp)}`,
    request.assignedCollector ? `Assigned Collector: ${request.assignedCollector}` : 'Not assigned'
  ];
  alert(lines.join('\n'));
}

async function assignRequest(requestId) {
  const request = window.adminDashboard.requests.find(r => r.id === requestId);
  if (!request) return;
  const active = window.adminDashboard.collectors.filter(c => c.status === 'Active');
  if (!active.length) { alert('No active collectors available.'); return; }

  const list = active.map(c => `${c.name} (${c.id})`).join('\n');
  const selected = prompt(`Available collectors:\n${list}\n\nEnter collector name or ID:`);
  if (!selected) return;

  const collector = active.find(c =>
    c.name.toLowerCase().includes(selected.toLowerCase()) ||
    c.id.toLowerCase().includes(selected.toLowerCase())
  );
  if (!collector) { alert('Collector not found.'); return; }

  try {
    await NSNR.api(`/api/requests/${requestId}`, {
      method: 'PATCH',
      role: 'admin',
      body: { assignedCollector: `${collector.name} (${collector.id})` }
    });
    await window.adminDashboard.refreshData();
    alert('Request assigned successfully!');
  } catch (err) {
    alert(err.message);
  }
}

async function generateReport() {
  const stats = await NSNR.api('/api/stats');
  const reqs = window.adminDashboard.requests;
  alert([
    '=== GARBAGE COLLECTION REPORT ===',
    `Generated: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}`,
    '',
    `Total Requests: ${stats.totalRequests}`,
    `Pending: ${stats.pendingRequests}`,
    `Completed: ${stats.completedRequests}`,
    `Active Collectors: ${stats.activeCollectors}`
  ].join('\n'));
}

async function exportData() {
  try {
    const data = await NSNR.api('/api/export', { role: 'admin' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = NSNR.createEl('a', { href: url, download: `garbage-collection-data-${new Date().toISOString().split('T')[0]}.json` });
    link.click();
    URL.revokeObjectURL(url);
    alert('Data exported successfully!');
  } catch (err) {
    alert(err.message);
  }
}

async function addScheduleAdmin() {
  const body = {
    date: document.getElementById('scheduleDate').value,
    area: document.getElementById('scheduleArea').value,
    type: document.getElementById('scheduleType').value,
    time: document.getElementById('scheduleTime').value,
    collector: document.getElementById('scheduleCollector').value.trim()
  };

  try {
    await NSNR.api('/api/schedules', { method: 'POST', role: 'admin', body });
    await window.adminDashboard.refreshData();
    alert('Schedule entry added.');
    document.getElementById('adminScheduleForm').reset();
  } catch (err) {
    alert(err.message);
  }
}

async function editScheduleAdmin(index) {
  const s = window.adminDashboard.schedules[index];
  if (!s) return;
  const newTime = prompt('Update time (HH:MM):', s.time) || s.time;
  const newCollector = prompt('Update collector (optional):', s.collector || '') ?? s.collector;

  try {
    await NSNR.api(`/api/schedules/${index}`, {
      method: 'PUT',
      role: 'admin',
      body: { time: newTime, collector: newCollector }
    });
    await window.adminDashboard.refreshData();
    alert('Schedule entry updated.');
  } catch (err) {
    alert(err.message);
  }
}

async function deleteScheduleAdmin(index) {
  if (!confirm('Delete this schedule entry?')) return;
  try {
    await NSNR.api(`/api/schedules/${index}`, { method: 'DELETE', role: 'admin' });
    await window.adminDashboard.refreshData();
  } catch (err) {
    alert(err.message);
  }
}

function toggleHint() {
  const credentialsDiv = document.getElementById('adminCredentials');
  const hintLink = document.getElementById('hintLink');
  if (!credentialsDiv || !hintLink) return;
  const show = credentialsDiv.hidden;
  credentialsDiv.hidden = !show;
  hintLink.textContent = show ? 'Hide Hint' : 'Hint';
  hintLink.setAttribute('aria-expanded', show ? 'true' : 'false');
}

function showAdminDashboard() {
  if (window.adminDashboard?.currentAdmin) {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'block';
  } else {
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('dashboardSection').style.display = 'none';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToAdminSection(sectionId) {
  if (window.adminDashboard?.currentAdmin) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
  } else {
    showAdminDashboard();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.adminDashboard = new AdminDashboard();
});
