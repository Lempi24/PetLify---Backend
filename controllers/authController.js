import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../database.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

export const getMe = async (req, res) => {
	try {
		const data = await pool.query(
			'SELECT * FROM users_data.users WHERE email = $1',
			[req.headers.useremail]
		);
		res.status(200).json(data.rows[0]);
	} catch (error) {
		console.error('FETCH USER DATA ERROR:', error.message);
		res.status(500).send();
	}
};

export const register = async (req, res) => {
	try {
		const { email, password, recaptchaToken } = req.body;
		if (!recaptchaToken) {
			return res.status(400).json({ message: 'Brak tokenu CAPTCHA' });
		}
		if (!email || !password)
			return res.status(400).send({ message: 'No email or password found' });
		const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`;
		const captchaRes = await axios.post(verificationUrl);
		const captchaData = captchaRes.data;

		if (!captchaData.success || captchaData.score < 0.5) {
			return res
				.status(400)
				.json({ message: 'Nie udało się zweryfikować CAPTCHA' });
		}
		const existingUser = await pool.query(
			'SELECT email FROM users_data.logins WHERE email = $1',
			[email]
		);
		if (existingUser.rows.length > 0)
			return res.status(409).send({ message: 'User already exists' });

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

		const token = crypto.randomBytes(32).toString('hex');
		const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); //24 godzinki jak coś

		await pool.query(
			'INSERT INTO users_data.verification_tokens (email, token, expires_at) VALUES ($1, $2, $3)',
			[email, token, expiresAt]
		);

		//Konfiguracja mailera na gmail

		const transporter = nodemailer.createTransport({
			service: 'gmail',
			auth: {
				user: process.env.EMAIL_USER,
				pass: process.env.EMAIL_PASS,
			},
		});

		const verifyLink = `${process.env.BASE_URL}/auth/verify?token=${token}`;

		await transporter.sendMail({
			from: process.env.EMAIL_USER,
			to: email,
			subject: 'Potwierdź swoje konto petlify',
			//Potem się to jakoś ładnie ostyluje... Może
			html: `
        <p>Cześć!</p>
        <p>Kliknij poniższy link, aby zweryfikować swoje konto:</p>
        <a href="${verifyLink}">${verifyLink}</a>
        <p>Link jest ważny 24 godziny.</p>
      `,
		});

		res.status(200).send({ message: 'Zgłoszenie dodane' });
	} catch (err) {
		console.error('REGISTER ERROR:', err.message);
		res.status(500).send();
	}
};

export const verifyEmail = async (req, res) => {
	try {
		const { token } = req.query;
		if (!token) {
			return res.status(400).send('No token acquired');
		}

		const result = await pool.query(
			'SELECT email, expires_at FROM users_data.verification_tokens WHERE token = $1',
			[token]
		);

		if (result.rows.length === 0) {
			return res.status(400).send('Tokens doesnt match');
		}
		const { email, expires_at } = result.rows[0];
		if (new Date() > expires_at) {
			await pool.query(
				'DELETE FROM users_data.verification_tokens WHERE token = $1',
				[token]
			);
			return res.status(400).send('Token expired');
		}
		await pool.query(
			"UPDATE users_data.logins SET verified = 'verified' WHERE email = $1",
			[email]
		);
		await pool.query(
			'DELETE FROM users_data.verification_tokens WHERE token = $1',
			[token]
		);

		res.status(200).send('Acount is verified, please log in');
	} catch (err) {
		console.error('VERIFY ERROR:', err.message);
		res.status(500).send('Server error');
	}
};

export const login = async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password) return res.status(400).send();

		const existingUser = await pool.query(
			`SELECT l.email, l.password, l.verified, u.sys_role
       FROM users_data.logins l
       LEFT JOIN users_data.users u ON l.email = u.email
       WHERE l.email = $1`,
			[email]
		);

		if (existingUser.rows.length == 0)
			return res.status(401).json({ message: 'Invalid credentials' });

		const user = existingUser.rows[0];

		if (user.verified !== 'verified') {
			return res
				.status(401)
				.json({ message: 'Account not verified. Please check your email.' });
		}

		const passwordCheck = await bcrypt.compare(password, user.password);
		if (!passwordCheck) return res.status(401).send();

		await pool.query(
			'UPDATE users_data.logins SET last_login = NOW() WHERE email = $1',
			[email]
		);
		const token = jwt.sign(
			{ email: user.email, role: user.sys_role },
			process.env.ACCESS_SECRET_TOKEN,
			{ expiresIn: '5h' }
		);

		res.status(200).json({ token });
	} catch (err) {
		console.error('LOGIN ERROR:', err.message);
		res.status(500).send();
	}
};
