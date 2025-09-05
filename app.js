import 'dotenv/config';

import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';

import pool from './database.js';
const app = express();
const port = 3000;

// app.get('/', (req, res) => {
//   res.send("test")
// })
app.use(express.json());
app.use(cors());
//Rejestracja
app.post('/register', async (req, res) => {
	try {
		const { email, password } = req.body;

		if (!email || !password) {
			return res.status(400).send();
		}

		const existingUser = await pool.query(
			'SELECT email FROM users_data.logins WHERE email = $1',
			[email]
		);

		if (existingUser.rows.length > 0) {
			return res.status(409).send();
		}

		const salt = await bcrypt.genSalt();
		const hashedPassword = await bcrypt.hash(password, salt);
		const createdAt = new Date();

		await pool.query(
			"INSERT INTO users_data.logins (email, password, created_at, verified, last_login) VALUES ($1, $2, $3, 'unverified', NULL)",
			[email, hashedPassword, createdAt]
		);

		res.status(201).send();
	} catch (err) {
		console.error('REGISTER ERROR:', err.message, err.code);
		res.status(500).send();
	}
});

//Logowanie
app.post('/login', async (req, res) => {
	try {
		const { email, password } = req.body;

		if (!email || !password) {
			return res
				.status(400)
				.send({ message: 'Email and password are required.' });
		}

		const existingUser = await pool.query(
			'SELECT email, password FROM users_data.logins WHERE email = $1',
			[email]
		);

		if (existingUser.rows.length == 0) {
			return res.status(401).send();
		}
		const user = existingUser.rows[0];

		const passwordCheck = await bcrypt.compare(password, user.password);
		if (!passwordCheck) {
			return res.status(401).send();
		}
		await pool.query(
			'UPDATE users_data.logins SET last_login = NOW() WHERE email = $1',
			[email]
		);
		const token = jwt.sign(
			{ email: user.email },
			process.env.ACCESS_SECRET_TOKEN,
			{ expiresIn: '2h' }
		);
		res.status(200).json({ token });
	} catch (err) {
		console.log(err);
		res.status(500).send();
	}
});

app.listen(port, () => {
	console.log(`App listening on port ${port}`);
});
