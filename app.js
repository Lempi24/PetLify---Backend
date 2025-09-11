import 'dotenv/config';

import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import multer from 'multer';
import pool from './database.js';
const app = express();
const port = 3000;
const upload = multer({ dest: '/uploads'})
const cloudinary = require('./cloudinary')
const fs = require

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

app.post('/main-page/create-lost-form', upload.single('photo'), async (req, res) => {
	try{
		const user = req.user;
		const { petSpecies, petBreed, petColor, petName, petAge, petSize, lostCity, lostStreet, lostCoordinates, description } = req.body;
		
		const userLostFormsCount = await pool.query(
			'SELECT COUNT(*) FROM  reports.lost_reports WHERE owner = $1',
			[user.email]
		);

		if(parseInt(userLostFormsCount.rows[0].count) >= 3){
			return res.status(401).send('Limit 3 zgłoszeń osiągnięty');
		}

		let photo_url = null;

		if(req.file){
			const result = await cloudinary.uploader.upload(req.file.path, { folder: 'lost_pets_photos'});
			photo_url = result.secure_url;
			fs.unlinkSync(req.file.path);
		}

		await pool.query(
			`INSERT INTO reports.lost_reports (owner, phone, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size, city, street, coordinates, description, photo_url) 
			VALUES ( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			[user.email, user.phone, petSpecies, petBreed, petColor, petName, petAge, petSize, lostCity, lostStreet, lostCoordinates, description, photo_url]
		);

	} catch (err){
		console.log(err);
		res.status(500).send();
	}
});

app.get('/reports/fetch-found', async (req, res) => {
	const city = req.body;

	if (!city){
		return res.status(400).send({message: 'City is required'})
	} 

	
});

app.listen(port, () => {
	console.log(`App listening on port ${port}`);
});
