import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import pool from './database.js';
import cloudinary from './cloudinary.js';
import authenticateToken from './tokenAuthorization.js';
import chatRouterFactory from './routes/chats.js';

const app = express();
const server = http.createServer(app);

// --- CORS ---
const FRONT_ORIGIN = process.env.FRONT_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: FRONT_ORIGIN, credentials: true }));
app.use(express.json());

// --- Socket.IO (JWT autoryzacja) ---
const io = new SocketIOServer(server, {
  cors: { origin: FRONT_ORIGIN, methods: ['GET', 'POST'] }
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) return next(new Error('No token'));
    const user = jwt.verify(token, process.env.ACCESS_SECRET_TOKEN);
    socket.user = user; // {email}
    next();
  } catch (e) {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const email = socket.user?.email;
  if (email) {
    // pokój użytkownika (powiadomienia)
    socket.join(`user:${email}`);
  }

  // dołączanie do pokoju konkretnego wątku
  socket.on('chat:join', ({ threadId }) => {
    if (!threadId) return;
    socket.join(`thread:${threadId}`);
  });

  // wysłanie wiadomości (zapis + broadcast)
  socket.on('chat:send', async ({ threadId, text = '', attachments = [] }) => {
    try {
      if (!threadId || (!text && attachments.length === 0)) return;

      const { rows: trows } = await pool.query(
        'SELECT id, owner_email, partner_email FROM chats.threads WHERE id = $1',
        [threadId]
      );
      const thread = trows[0];
      if (!thread) return;

      const messageId = uuidv4();
      const createdAt = new Date();

      await pool.query(
        `INSERT INTO chats.messages (id, thread_id, sender_email, text, attachments, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [messageId, threadId, socket.user.email, text, JSON.stringify(attachments || []), createdAt]
      );

      await pool.query(
        `UPDATE chats.threads
           SET last_message = $1, last_time = $2
         WHERE id = $3`,
        [text || (attachments[0]?.name || 'Załącznik'), createdAt, threadId]
      );

      const payload = {
        id: messageId,
        threadId,
        senderEmail: socket.user.email,
        text,
        attachments,
        createdAt: createdAt.toISOString()
      };

      // do wszystkich uczestników wątku
      io.to(`thread:${threadId}`).emit('chat:newMessage', payload);

      // powiadomienia na poziomie user-room
      io.to(`user:${thread.owner_email}`).emit('chat:notify', { threadId, preview: payload });
      io.to(`user:${thread.partner_email}`).emit('chat:notify', { threadId, preview: payload });
    } catch (err) {
      console.error('SOCKET send error:', err.message);
    }
  });
});

// --- Multer do uploadów w formularzach (bez czatów) ---
const upload = multer({ dest: './uploads' });

// ====== DOTYCHCZASOWE ENDPOINTY (twoje, bez zmian istotnych) ======
app.get('/auth/me', async (req, res) => {
  try {
    const data = await pool.query(
      'SELECT * FROM users_data.users WHERE email = $1',
      [req.headers.useremail]
    );
    res.status(200).json(data.rows[0]);
  } catch (error) {
    console.error('FETCH USER DATA ERROR:', error.message, error.code);
    res.status(500).send();
  }
});

// Rejestracja
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send();

    const existingUser = await pool.query(
      'SELECT email FROM users_data.logins WHERE email = $1',
      [email]
    );
    if (existingUser.rows.length > 0) return res.status(409).send();

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);
    const createdAt = new Date();

    await pool.query(
      "INSERT INTO users_data.logins (email, password, created_at, verified, last_login) VALUES ($1, $2, $3, 'unverified', NULL)",
      [email, hashedPassword, createdAt]
    );
    await pool.query(
      'INSERT INTO users_data.settings (email, notify_new_chats, notify_missing, default_location) VALUES ($1, false, false, NULL)',
      [email]
    );
    res.status(200).send({ message: 'Zgłoszenie dodane' });
  } catch (err) {
    console.error('REGISTER ERROR:', err.message, err.code);
    res.status(500).send();
  }
});

// Logowanie
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send({ message: 'Email and password are required.' });

    const existingUser = await pool.query(
      'SELECT email, password FROM users_data.logins WHERE email = $1',
      [email]
    );
    if (existingUser.rows.length == 0) return res.status(401).send();

    const user = existingUser.rows[0];
    const passwordCheck = await bcrypt.compare(password, user.password);
    if (!passwordCheck) return res.status(401).send();

    await pool.query(
      'UPDATE users_data.logins SET last_login = NOW() WHERE email = $1',
      [email]
    );
    const token = jwt.sign({ email: user.email }, process.env.ACCESS_SECRET_TOKEN, { expiresIn: '2h' });
    res.status(200).json({ token });
  } catch (err) {
    console.log(err);
    res.status(500).send();
  }
});

// ====== SETTINGS (jak było) ======
app.put('/settings/update-user-info', authenticateToken, async (req, res) => {
  try {
    const { email, name, surname, phoneNumber } = req.body;
    await pool.query(
      'UPDATE users_data.users SET first_name = $1, surname = $2, phone = $3 WHERE email = $4',
      [name, surname, phoneNumber, email]
    );
    res.status(200).send({ message: 'Dane zaktualizowane' });
  } catch (error) {
    console.error('UPDATE USER DATA ERROR:', error.message, error.code);
    res.status(500).send();
  }
});

app.put('/settings/update-location', authenticateToken, async (req, res) => {
  try {
    const { email, city, country, latitude, longitude } = req.body;
    await pool.query(
      'UPDATE users_data.settings SET default_location = $1, default_location_lat = $2, default_location_lng = $3 WHERE email = $4',
      [city, latitude, longitude, email]
    );
    await pool.query(
      'UPDATE users_data.users SET city = $1, country = $2 WHERE email = $3',
      [city, country, email]
    );
    res.status(200).send({ message: 'Lokalizacja zaktualizowana' });
  } catch (error) {
    console.error('UPDATE USER LOCATION ERROR:', error.message, error.code);
    res.status(500).send();
  }
});

app.put('/settings/notifications', authenticateToken, async (req, res) => {
  try {
    const { notify_new_chats, notify_missing, email } = req.body;
    await pool.query(
      'UPDATE users_data.settings SET notify_new_chats = $1, notify_missing = $2 WHERE email = $3',
      [notify_new_chats, notify_missing, email]
    );
    res.status(200).send({ message: 'Ustawienia zaktualizowane' });
  } catch (error) {
    console.error('UPDATE USER NOTIFICATIONS ERROR:', error.message, error.code);
    res.status(500).send();
  }
});

app.get('/settings/fetch-user-settings', authenticateToken, async (req, res) => {
  const email = req.user.email;
  try {
    const settings = await pool.query('SELECT * FROM users_data.settings WHERE email = $1', [email]);
    res.status(200).json(settings.rows[0]);
  } catch (error) {
    console.error('FETCH USER SETTINGS ERROR:', error.message, error.code);
    res.status(500).send();
  }
});

app.delete('/settings/delete-user', authenticateToken, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });
    await pool.query('DELETE FROM users_data.logins WHERE email = $1', [email]);
    await pool.query('DELETE FROM users_data.users WHERE email = $1', [email]);
    res.status(200).json({ message: 'Konto usunięte' });
  } catch (error) {
    console.error('DELETE USER ERROR:', error.message, error.code);
    res.status(500).send();
  }
});

app.put('/settings/update-password', authenticateToken, async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    const userPassword = await pool.query(
      'SELECT password FROM users_data.logins WHERE email = $1',
      [email]
    );
    const passwordCheck = await bcrypt.compare(currentPassword, userPassword.rows[0].password);
    if (!passwordCheck) return res.status(401).send({ message: 'Błędne hasło' });

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await pool.query('UPDATE users_data.logins SET password = $1 WHERE email = $2', [hashedPassword, email]);
    res.status(200).send({ message: 'Hasło zaktualizowane' });
  } catch (error) {
    console.error('UPDATE USER PASSWORD ERROR:', error.message, error.code);
    res.status(500).send();
  }
});

// ====== FORMULARZE (jak było) ======
const photoUpload = multer({ dest: './uploads' });

app.post('/main-page/create-lost-form', authenticateToken, photoUpload.array('photos', 5), async (req, res) => {
  try {
    const user = req.user;
    const {
      petSpecies, petBreed, petColor, petName, petAge, petSize,
      lostDate, lostCity, lostStreet, lostCoordinates, description
    } = req.body;

    const userLostFormsCount = await pool.query(
      'SELECT COUNT(*) FROM  reports.lost_reports WHERE owner = $1',
      [user.email]
    );
    if (parseInt(userLostFormsCount.rows[0].count) >= 3) return res.status(401).send('Limit 3 zgłoszeń osiągnięty');

    let photo_urls = [];
    if (req.files && req.files.length > 0) {
      const results = await Promise.all(
        req.files.map((file) => cloudinary.uploader.upload(file.path, { folder: 'lost_pets_photos' }))
      );
      photo_urls = results.map((r) => r.secure_url);
      req.files.forEach((f) => fs.unlinkSync(f.path));
    } else {
      return res.status(400).send('Brak wymaganego zdjęcia');
    }

    const [lat, lng] = lostCoordinates.split(',').map(Number);

    await pool.query(
      `INSERT INTO reports.lost_reports (owner, phone, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size, lost_date, city, street, coordinates, description, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,POINT($12,$13),$14,$15)`,
      [user.email, user.phone, petSpecies, petBreed, petColor, petName, petAge, petSize, lostDate, lostCity, lostStreet, lng, lat, description, photo_urls]
    );

    res.status(200).send({ message: 'Zgłoszenie dodane' });
  } catch (err) {
    console.log(err);
    if (req.files) req.files.forEach((file) => fs.unlinkSync(file.path));
    res.status(500).send('Błąd serwera');
  }
});

app.post('/main-page/create-found-form', authenticateToken, photoUpload.array('photos', 5), async (req, res) => {
  try {
    const user = req.user;
    const {
      petName, petSpecies, petBreed, petColor, petAge, petSize,
      foundDate, foundCity, foundStreet, foundCoordinates, description
    } = req.body;

    const userFoundFormsCount = await pool.query(
      'SELECT COUNT(*) FROM  reports.found_reports WHERE owner = $1',
      [user.email]
    );
    if (parseInt(userFoundFormsCount.rows[0].count) >= 3) return res.status(401).send('Limit 3 zgłoszeń osiągnięty');

    let photo_urls = [];
    if (req.files && req.files.length > 0) {
      const results = await Promise.all(
        req.files.map((file) => cloudinary.uploader.upload(file.path, { folder: 'found_pets_photos' }))
      );
      photo_urls = results.map((r) => r.secure_url);
      req.files.forEach((f) => fs.unlinkSync(f.path));
    } else {
      return res.status(400).send('Brak wymaganego zdjęcia');
    }

    const [lat, lng] = foundCoordinates.split(',').map(Number);

    await pool.query(
      `INSERT INTO reports.found_reports (owner, phone, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size, found_date, city, street, coordinates, description, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,POINT($12,$13),$14,$15)`,
      [user.email, user.phone, petSpecies, petBreed, petColor, petName, petAge, petSize, foundDate, foundCity, foundStreet, lng, lat, description, photo_urls]
    );

    res.status(200).send({ message: 'Zgłoszenie dodane' });
  } catch (err) {
    console.log(err);
    if (req.files) req.files.forEach((file) => fs.unlinkSync(file.path));
    res.status(500).send('Błąd serwera');
  }
});


// pobieranie kart
app.get('/main-page/fetch-pets', async (req, res) => {
  const { type } = req.query;
  const tableMap = { lost: 'reports.lost_reports', found: 'reports.found_reports' };
  const tableName = tableMap[type];
  if (!tableName) return res.status(400).json({ error: 'Invalid type' });

  try {
    const pets = await pool.query(
      `SELECT pets.*, users.phone FROM ${tableName} AS pets, users_data.users AS users WHERE pets.owner = users.email`
    );
    res.status(200).json(pets.rows);
  } catch (error) {
    res.status(500).send();
    console.error('FETCH PETS ERROR:', error.message, error.code);
  }

// === PUBLIC: feed na stronę główną ===
app.get('/main-page/fetch-pets', async (req, res) => {
  const { type } = req.query;

  // whitelist: tylko te dwie tabele mogą być użyte
  const tableMap = {
    lost: 'reports.lost_reports',
    found: 'reports.found_reports',
  };
  const tableName = tableMap[type];
  if (!tableName) return res.status(400).json({ error: 'Invalid type' });

  try {
    const sql = `
      SELECT 
        p.id,
        p.title,
        p.description,
        p.animal,
        p.breed,
        p.color,
        p.city,
        p.date,
        p.owner,
        u.phone
      FROM ${tableName} AS p
      LEFT JOIN users_data.users AS u
        ON p.owner = u.email
      ORDER BY p.date DESC
      LIMIT 100
    `;
    const { rows } = await pool.query(sql);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('FETCH PETS ERROR:', error.message, error.code);
    return res.status(500).json({ error: 'Database error' });
  }
});


// === PRIVATE: raporty zalogowanego użytkownika ===
app.get('/user-reports/fetch-reports', authenticateToken, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const lostSql  = `
      SELECT id, title, description, animal, breed, color, city, date, owner
      FROM reports.lost_reports
      WHERE owner = $1
      ORDER BY date DESC
    `;
    const foundSql = `
      SELECT id, title, description, animal, breed, color, city, date, owner
      FROM reports.found_reports
      WHERE owner = $1
      ORDER BY date DESC
    `;

    const [lostResult, foundResult] = await Promise.all([
      pool.query(lostSql,  [email]),
      pool.query(foundSql, [email]),
    ]);

    return res.json({
      lost:  lostResult.rows,
      found: foundResult.rows,
    });
  } catch (err) {
    console.error('USER REPORTS ERROR:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

});

// ====== ROUTES: CHATS (NOWE) ======
app.use('/chats', chatRouterFactory(io));

// ====== START ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`App + Socket.IO listening on :${PORT}`));
