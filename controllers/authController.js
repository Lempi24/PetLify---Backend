import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../database.js';

export const getMe = async (req, res) => {
  try {
    const data = await pool.query('SELECT * FROM users_data.users WHERE email = $1', [req.headers.useremail]);
    res.status(200).json(data.rows[0]);
  } catch (error) {
    console.error('FETCH USER DATA ERROR:', error.message);
    res.status(500).send();
  }
};

export const register = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send();

    const existingUser = await pool.query('SELECT email FROM users_data.logins WHERE email = $1', [email]);
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
    console.error('REGISTER ERROR:', err.message);
    res.status(500).send();
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send();

    const existingUser = await pool.query(
      `SELECT l.email, l.password, u.sys_role
       FROM users_data.logins l
       LEFT JOIN users_data.users u ON l.email = u.email
       WHERE l.email = $1`, [email]
    );

    if (existingUser.rows.length == 0) return res.status(401).send();

    const user = existingUser.rows[0];
    const passwordCheck = await bcrypt.compare(password, user.password);
    if (!passwordCheck) return res.status(401).send();

    await pool.query('UPDATE users_data.logins SET last_login = NOW() WHERE email = $1', [email]);
    const token = jwt.sign({ email: user.email, role: user.sys_role }, process.env.ACCESS_SECRET_TOKEN, { expiresIn: '2h' });

    res.status(200).json({ token });
  } catch (err) {
    console.error('LOGIN ERROR:', err.message);
    res.status(500).send();
  }
};
