'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nsnr-dev-secret-change-in-production';
const DEMO_HINTS = process.env.DEMO_HINTS !== 'false';
const DB_PATH = path.join(__dirname, 'data', 'db.json');

const app = express();
const sseClients = new Set();
let writeQueue = Promise.resolve();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.static(__dirname, { index: 'index.html' }));

function readDb() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeDb(data) {
  writeQueue = writeQueue.then(() => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    broadcast('data-changed', { at: new Date().toISOString() });
  });
  return writeQueue;
}

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

async function seedDatabase() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH)) return;

  const passwordHash = await bcrypt.hash('admin@123', 10);
  const db = {
    admin: {
      username: 'admin',
      passwordHash,
      name: 'Administrator'
    },
    collectors: [
      { id: 'C001', name: 'Jeff Amondi', phone: '+254-712-345-678', area: 'USIU', status: 'Active', passwordHash },
      { id: 'C002', name: 'Kevin Kiptoo', phone: '+254-723-456-789', area: 'Mirema', status: 'Active', passwordHash },
      { id: 'C003', name: 'Reagan Omondi', phone: '+254-734-567-890', area: 'Roysambu', status: 'Active', passwordHash },
      { id: 'C004', name: 'David Cj', phone: '+254-745-678-901', area: 'Roasters', status: 'Active', passwordHash }
    ],
    requests: [],
    schedules: [],
    tenants: []
  };

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function ensureSchedules(db) {
  if (db.schedules.length > 0) return db;
  const areas = ['USIU', 'Mirema', 'Roysambu', 'Roasters', 'Lumumba Drive'];
  const wasteTypes = ['Biodegradable', 'Recyclable', 'Hazardous'];
  const today = new Date();

  for (let i = 0; i < 5; i++) {
    const date = new Date(today.getTime() + i * 86400000);
    const dateStr = date.toISOString().split('T')[0];
    const dayName = date.toLocaleDateString('en-KE', { weekday: 'long', timeZone: 'Africa/Nairobi' });
    areas.forEach((area, index) => {
      const collector = db.collectors[index % db.collectors.length];
      const hours = Math.floor(Math.random() * 8) + 6;
      const minutes = [0, 15, 30, 45][Math.floor(Math.random() * 4)];
      db.schedules.push({
        date: dateStr,
        dayName,
        area,
        type: wasteTypes[index % wasteTypes.length],
        time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
        collector: `${collector.name} (${collector.id})`
      });
    });
  }
  return db;
}

function sanitizeCollector(c) {
  const { passwordHash, ...safe } = c;
  return safe;
}

function generateRequestId() {
  return 'REQ' + Date.now().toString(36).toUpperCase();
}

function generateTenantId() {
  return 'TEN' + Date.now().toString(36).toUpperCase();
}

const VALID_WASTE_TYPES = ['Biodegradable', 'Recyclable', 'Hazardous', 'Electronic', 'Medical'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const VALID_AREAS = ['USIU', 'Mirema', 'Roysambu', 'Roasters', 'Lumumba Drive'];
const VALID_STATUSES = ['Pending', 'In Progress', 'Completed'];

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function validateRequestInput(body) {
  const residentId = String(body.residentId || '').trim();
  const residentName = String(body.residentName || '').trim();
  const wasteType = String(body.wasteType || '').trim();
  const priority = String(body.priority || 'Medium').trim();
  const address = String(body.address || '').trim();
  const phone = String(body.phone || '').trim();
  const description = String(body.description || '').trim().slice(0, 500);
  const preferredDate = body.preferredDate ? String(body.preferredDate).trim() : '';

  if (!/^[A-Za-z0-9_-]{3,20}$/.test(residentId)) {
    throw validationError('Resident ID must be 3–20 alphanumeric characters.');
  }
  if (!/^[A-Za-z\s'.-]{2,100}$/.test(residentName)) {
    throw validationError('Full name must be 2–100 letters.');
  }
  if (!VALID_WASTE_TYPES.includes(wasteType)) {
    throw validationError('Invalid waste type.');
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    throw validationError('Invalid priority.');
  }
  if (address.length < 5 || address.length > 200) {
    throw validationError('Address must be 5–200 characters.');
  }
  if (!/^\+?[0-9\s-]{9,15}$/.test(phone)) {
    throw validationError('Enter a valid phone number (9–15 digits).');
  }
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
    throw validationError('Invalid preferred date.');
  }

  return { residentId, residentName, wasteType, priority, address, phone, description, preferredDate };
}

function validateTenantInput(body) {
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const idNumber = String(body.idNumber || '').trim();
  const area = String(body.area || '').trim();
  const houseNo = String(body.houseNo || '').trim();
  const address = String(body.address || '').trim();
  const password = String(body.password || '');

  if (!/^[A-Za-z\s'.-]{2,100}$/.test(name)) {
    throw validationError('Name must be 2–100 letters.');
  }
  if (!/^\+?[0-9\s-]{9,15}$/.test(phone)) {
    throw validationError('Enter a valid phone number.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw validationError('Enter a valid email address.');
  }
  if (!/^[A-Za-z0-9]{5,20}$/.test(idNumber)) {
    throw validationError('ID number must be 5–20 alphanumeric characters.');
  }
  if (!VALID_AREAS.includes(area)) {
    throw validationError('Select a valid area.');
  }
  if (houseNo.length < 1 || houseNo.length > 20) {
    throw validationError('House number is required.');
  }
  if (address.length < 5 || address.length > 200) {
    throw validationError('Address must be 5–200 characters.');
  }
  if (password.length < 8) {
    throw validationError('Password must be at least 8 characters.');
  }

  return { name, phone, email, idNumber, area, houseNo, address, password };
}

function validateCollectorInput(body, existingId) {
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const area = String(body.area || '').trim();
  const status = String(body.status || 'Active').trim();

  if (!/^[A-Za-z\s'.-]{2,100}$/.test(name)) {
    throw validationError('Collector name must be 2–100 letters.');
  }
  if (!/^\+?[0-9\s-]{9,15}$/.test(phone)) {
    throw validationError('Enter a valid phone number.');
  }
  if (!VALID_AREAS.includes(area)) {
    throw validationError('Select a valid area.');
  }
  if (!['Active', 'Inactive'].includes(status)) {
    throw validationError('Status must be Active or Inactive.');
  }

  return { name, phone, area, status, id: existingId };
}

function validateScheduleInput(body) {
  const date = String(body.date || '').trim();
  const area = String(body.area || '').trim();
  const type = String(body.type || '').trim();
  const time = String(body.time || '').trim();
  const collector = String(body.collector || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw validationError('Invalid schedule date.');
  }
  if (!VALID_AREAS.includes(area)) {
    throw validationError('Invalid area.');
  }
  if (!['Biodegradable', 'Recyclable', 'Hazardous'].includes(type)) {
    throw validationError('Invalid waste type for schedule.');
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw validationError('Time must be HH:MM format.');
  }

  return { date, area, type, time, collector };
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

function authMiddleware(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    try {
      const user = jwt.verify(token, JWT_SECRET);
      if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions.' });
      }
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
  };
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/config/demo-hints', (req, res) => {
  if (!DEMO_HINTS) {
    return res.json({ enabled: false });
  }
  res.json({
    enabled: true,
    admin: { username: 'admin', password: 'admin@123' },
    collectors: { ids: ['C001', 'C002', 'C003', 'C004'], password: 'admin@123' }
  });
});

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim();

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }

  const db = readDb();
  let tokenPayload = null;

  if (role === 'admin') {
    if (username !== db.admin.username) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const valid = await bcrypt.compare(password, db.admin.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password.' });
    tokenPayload = { role: 'admin', username: db.admin.username, name: db.admin.name };
  } else if (role === 'collector') {
    const collector = db.collectors.find(c => c.id === username);
    if (!collector) {
      return res.status(401).json({ error: 'Invalid Collector ID or password.' });
    }
    const valid = await bcrypt.compare(password, collector.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid Collector ID or password.' });
    tokenPayload = {
      role: 'collector',
      id: collector.id,
      username: collector.id,
      name: collector.name,
      phone: collector.phone,
      area: collector.area
    };
  } else {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  const token = signToken(tokenPayload);
  res.json({ token, user: tokenPayload });
}));

app.get('/api/auth/me', authMiddleware(), (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/stats', (req, res) => {
  const db = readDb();
  const today = new Date().toISOString().split('T')[0];
  const uniqueResidents = new Set(db.requests.map(r => r.residentId)).size;
  const activeCollectors = db.collectors.filter(c => c.status === 'Active').length;
  const completedToday = db.requests.filter(r => r.status === 'Completed' && r.collectionDate === today).length;

  res.json({
    totalResidents: uniqueResidents,
    activeCollectors,
    completedToday,
    totalRequests: db.requests.length,
    pendingRequests: db.requests.filter(r => r.status === 'Pending').length,
    completedRequests: db.requests.filter(r => r.status === 'Completed').length
  });
});

app.get('/api/requests', authMiddleware(['admin', 'collector']), (req, res) => {
  const db = readDb();
  if (req.user.role === 'admin') {
    return res.json(db.requests);
  }
  const id = req.user.id;
  const assigned = db.requests.filter(r => r.assignedCollector && r.assignedCollector.includes(id));
  res.json(assigned);
});

app.get('/api/requests/track/:query', (req, res) => {
  const query = String(req.params.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Search query required.' });
  const db = readDb();
  const results = db.requests.filter(r => r.id === query || r.residentId === query);
  res.json(results);
});

app.post('/api/requests', asyncHandler(async (req, res) => {
  const input = validateRequestInput(req.body);
  const db = readDb();

  const request = {
    id: generateRequestId(),
    ...input,
    status: 'Pending',
    timestamp: new Date().toISOString(),
    assignedCollector: null,
    collectionDate: null,
    notes: ''
  };

  db.requests.push(request);
  await writeDb(db);
  res.status(201).json(request);
}));

app.patch('/api/requests/:id', authMiddleware(['admin', 'collector']), asyncHandler(async (req, res) => {
  const db = readDb();
  const request = db.requests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });

  if (req.user.role === 'collector') {
    const assigned = request.assignedCollector || '';
    if (!assigned.includes(req.user.id)) {
      return res.status(403).json({ error: 'Not assigned to this request.' });
    }
  }

  const { status, assignedCollector, notes } = req.body;

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) throw validationError('Invalid status.');
    request.status = status;
    if (status === 'Completed') {
      request.collectionDate = new Date().toISOString().split('T')[0];
    }
  }

  if (assignedCollector !== undefined && req.user.role === 'admin') {
    request.assignedCollector = String(assignedCollector).trim() || null;
  }

  if (notes !== undefined) {
    request.notes = String(notes).trim().slice(0, 500);
  }

  await writeDb(db);
  res.json(request);
}));

app.post('/api/requests/assign-bulk', authMiddleware(['admin']), asyncHandler(async (req, res) => {
  const db = readDb();
  const unassigned = db.requests.filter(r => !r.assignedCollector);
  const active = db.collectors.filter(c => c.status === 'Active');

  if (active.length === 0) {
    return res.status(400).json({ error: 'No active collectors available.' });
  }

  unassigned.forEach(reqItem => {
    const collector = active[Math.floor(Math.random() * active.length)];
    reqItem.assignedCollector = `${collector.name} (${collector.id})`;
  });

  await writeDb(db);
  res.json({ assigned: unassigned.length });
}));

app.get('/api/collectors', (req, res) => {
  const db = readDb();
  res.json(db.collectors.map(sanitizeCollector));
});

app.post('/api/collectors', authMiddleware(['admin']), asyncHandler(async (req, res) => {
  const db = readDb();
  const input = validateCollectorInput(req.body);

  const existingIds = db.collectors.map(c => parseInt(c.id.replace('C', ''), 10)).filter(n => !isNaN(n));
  const nextNum = existingIds.length ? Math.max(...existingIds) + 1 : 1;
  const id = 'C' + String(nextNum).padStart(3, '0');

  if (db.collectors.some(c => c.id === id)) {
    throw validationError('Collector ID conflict.');
  }

  const passwordHash = await bcrypt.hash('admin@123', 10);
  const collector = { id, ...input, passwordHash };
  db.collectors.push(collector);
  await writeDb(db);
  res.status(201).json(sanitizeCollector(collector));
}));

app.put('/api/collectors/:id', authMiddleware(['admin']), asyncHandler(async (req, res) => {
  const db = readDb();
  const collector = db.collectors.find(c => c.id === req.params.id);
  if (!collector) return res.status(404).json({ error: 'Collector not found.' });

  const input = validateCollectorInput(req.body, collector.id);
  Object.assign(collector, input);
  await writeDb(db);
  res.json(sanitizeCollector(collector));
}));

app.delete('/api/collectors/:id', authMiddleware(['admin']), asyncHandler(async (req, res) => {
  const db = readDb();
  const before = db.collectors.length;
  db.collectors = db.collectors.filter(c => c.id !== req.params.id);
  if (db.collectors.length === before) {
    return res.status(404).json({ error: 'Collector not found.' });
  }
  await writeDb(db);
  res.json({ ok: true });
}));

app.get('/api/schedules', (req, res) => {
  const db = readDb();
  res.json(db.schedules);
});

app.post('/api/schedules', authMiddleware(['admin']), asyncHandler(async (req, res) => {
  const input = validateScheduleInput(req.body);
  const db = readDb();

  const conflict = db.schedules.some(s =>
    s.date === input.date && s.area === input.area && s.time === input.time
  );
  if (conflict) {
    throw validationError('Schedule conflict: same date, area, and time already exists.');
  }

  const dayName = new Date(input.date + 'T12:00:00').toLocaleDateString('en-KE', {
    weekday: 'long',
    timeZone: 'Africa/Nairobi'
  });

  const entry = { ...input, dayName };
  db.schedules.push(entry);
  await writeDb(db);
  res.status(201).json(entry);
}));

app.put('/api/schedules/:index', authMiddleware(['admin']), asyncHandler(async (req, res) => {
  const index = parseInt(req.params.index, 10);
  const db = readDb();
  const schedule = db.schedules[index];
  if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });

  if (req.body.time !== undefined) {
    const time = String(req.body.time).trim();
    if (!/^\d{2}:\d{2}$/.test(time)) throw validationError('Time must be HH:MM format.');
    schedule.time = time;
  }
  if (req.body.collector !== undefined) {
    schedule.collector = String(req.body.collector).trim();
  }

  await writeDb(db);
  res.json(schedule);
}));

app.delete('/api/schedules/:index', authMiddleware(['admin']), asyncHandler(async (req, res) => {
  const index = parseInt(req.params.index, 10);
  const db = readDb();
  if (!db.schedules[index]) return res.status(404).json({ error: 'Schedule not found.' });
  db.schedules.splice(index, 1);
  await writeDb(db);
  res.json({ ok: true });
}));

app.post('/api/tenants/register', asyncHandler(async (req, res) => {
  const input = validateTenantInput(req.body);
  const db = readDb();

  const duplicate = db.tenants.find(t => t.phone === input.phone || t.idNumber === input.idNumber);
  if (duplicate) {
    throw validationError('A tenant with this phone number or ID already exists.');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const tenant = {
    id: generateTenantId(),
    name: input.name,
    phone: input.phone,
    email: input.email,
    idNumber: input.idNumber,
    area: input.area,
    houseNo: input.houseNo,
    address: input.address,
    passwordHash,
    registeredAt: new Date().toISOString()
  };

  db.tenants.push(tenant);
  await writeDb(db);

  const { passwordHash: _, ...safe } = tenant;
  res.status(201).json(safe);
}));

app.get('/api/export', authMiddleware(['admin']), (req, res) => {
  const db = readDb();
  res.json({
    requests: db.requests,
    collectors: db.collectors.map(sanitizeCollector),
    schedules: db.schedules,
    tenants: db.tenants.map(({ passwordHash, ...t }) => t),
    exportDate: new Date().toISOString()
  });
});

seedDatabase().then(async () => {
  const db = readDb();
  await ensureSchedules(db);
  await writeDb(db);
  app.listen(PORT, () => {
    console.log(`NSNR server running at http://localhost:${PORT}`);
  });
});
