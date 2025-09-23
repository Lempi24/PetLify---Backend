import 'dotenv/config';

import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import multer from 'multer';
import pool from './database.js';
import cloudinary from './cloudinary.js';
import fs from 'fs';
import authenticateToken from './tokenAuthorization.js';

const app = express();
const port = 3000;
const upload = multer({ dest: './uploads' });

app.use(express.json());
app.use(cors());
//Auth
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

		res.status(200).send({ message: 'Zgłoszenie dodane' });
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
//settings
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
app.put('/settings/update-password', authenticateToken, async (req, res) => {
	try {
		const { email, currentPassword, newPassword } = req.body;
		const userPassword = await pool.query(
			'SELECT password FROM users_data.logins WHERE email = $1',
			[email]
		);
		const passwordCheck = await bcrypt.compare(
			currentPassword,
			userPassword.rows[0].password
		);
		if (!passwordCheck) {
			return res.status(401).send({ message: 'Błędne hasło' });
		}
		const salt = await bcrypt.genSalt();
		const hashedPassword = await bcrypt.hash(newPassword, salt);
		await pool.query(
			'UPDATE users_data.logins SET password = $1 WHERE email = $2',
			[hashedPassword, email]
		);
		res.status(200).send({ message: 'Hasło zaktualizowane' });
	} catch (error) {
		console.error('UPDATE USER PASSWORD ERROR:', error.message, error.code);
		res.status(500).send();
	}
});
//main-page
app.post(
	'/main-page/create-lost-form',
	authenticateToken,
	upload.array('photos', 5),
	async (req, res) => {
		try {
			const user = req.user;
			const {
				petSpecies,
				petBreed,
				petColor,
				petName,
				petAge,
				petSize,
				lostDate,
				lostCity,
				lostStreet,
				lostCoordinates,
				description,
			} = req.body;

			console.log('REQ.BODY:', req.body);
			console.log('REQ.USER:', req.user);

			console.log('Wysyłam dane:', {
				petSpecies,
				petBreed,
				petColor,
				petName,
				petAge,
				petSize,
				lostDate,
				lostCity,
				lostStreet,
				lostCoordinates,
				description,
			});

			const userLostFormsCount = await pool.query(
				'SELECT COUNT(*) FROM  reports.lost_reports WHERE owner = $1',
				[user.email]
			);

			if (parseInt(userLostFormsCount.rows[0].count) >= 3) {
				return res.status(401).send('Limit 3 zgłoszeń osiągnięty');
			}

			let photo_urls = [];

			if (req.files && req.files.length > 0) {
				const uploadPromises = req.files.map((file) => {
					return cloudinary.uploader.upload(file.path, {
						folder: 'lost_pets_photos',
					});
				});

				const results = await Promise.all(uploadPromises);

				photo_urls = results.map((result) => result.secure_url);

				req.files.forEach((file) => fs.unlinkSync(file.path));
			} else {
				return res.status(400).send('Brak wymaganego zdjęcia');
			}

			const [lat, lng] = lostCoordinates.split(',').map(Number);

			await pool.query(
				`INSERT INTO reports.lost_reports (owner, phone, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size, lost_date, city, street, coordinates, description, photo_url) 
			VALUES ( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, POINT($12, $13), $14, $15)`,
				[
					user.email,
					user.phone,
					petSpecies,
					petBreed,
					petColor,
					petName,
					petAge,
					petSize,
					lostDate,
					lostCity,
					lostStreet,
					lng,
					lat,
					description,
					photo_urls,
				]
			);

			res.status(200).send({ message: 'Zgłoszenie dodane' });
		} catch (err) {
			console.log(err);
			if (req.files) {
				req.files.forEach((file) => fs.unlinkSync(file.path));
			}
			res.status(500).send('Błąd serwera');
		}
	}
);

app.post('/main-page/create-found-form', authenticateToken, upload.array('photos', 5), async (req, res) => {
	try{
		const user = req.user;
		const {
			petName,
			petSpecies,
			petBreed,
			petColor,
			petAge,
			petSize,
			foundDate,
			foundCity,
			foundStreet,
			foundCoordinates,
			description
		} = req.body;

		console.log('REQ.BODY:', req.body);
		console.log('REQ.USER:', req.user);

		console.log('Wysyłam dane:', {
				petSpecies,
				petBreed,
				petColor,
				petName,
				petAge,
				petSize,
				foundDate,
				foundCity,
				foundStreet,
				foundCoordinates,
				description
			});

		const userFoundFormsCount = await pool.query(
			'SELECT COUNT(*) FROM  reports.found_reports WHERE owner = $1',
			[user.email]
		);

		if (parseInt(userFoundFormsCount.rows[0].count) >= 3) {
			return res.status(401).send('Limit 3 zgłoszeń osiągnięty');
		}
		let photo_urls = [];

		if (req.files && req.files.length > 0) {
			const uploadPromises = req.files.map((file) => {
				return cloudinary.uploader.upload(file.path, {
					folder: 'found_pets_photos',
				});
			});

			const results = await Promise.all(uploadPromises);

			photo_urls = results.map((result) => result.secure_url);

			req.files.forEach((file) => fs.unlinkSync(file.path));
		} else {
			return res.status(400).send('Brak wymaganego zdjęcia');
		}

		const [lat, lng] = foundCoordinates.split(',').map(Number);

		await pool.query(
			`INSERT INTO reports.found_reports (owner, phone, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size, found_date, city, street, coordinates, description, photo_url) 
			VALUES ( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, POINT($12, $13), $14, $15)`,
			[
				user.email,
				user.phone,
				petSpecies,
				petBreed,
				petColor,
				petName,
				petAge,
				petSize,
				foundDate,
				foundCity,
				foundStreet,
				lng,
				lat,
				description,
				photo_urls,
			]
		);

		res.status(200).send({ message: 'Zgłoszenie dodane' });
	} catch (err) {
		console.log(err);
		if (req.files) {
			req.files.forEach((file) => fs.unlinkSync(file.path));
		}
		res.status(500).send('Błąd serwera');
	}
})


app.get('/reports/fetch-found', async (req, res) => {
	const city = req.body;

	if (!city) {
		return res.status(400).send({ message: 'City is required' });
	}
});

app.get('/main-page/fetch-pets', async (req, res) => {
	const { type } = req.query;

	const tableMap = {
		lost: 'reports.lost_reports',
		found: 'reports.found_reports',
	};
	const tableName = tableMap[type];
	if (!tableName) {
		return res.status(400).json({ error: 'Invalid type' });
	}
	try {
		const pets = await pool.query(
			`SELECT pets.*, users.phone FROM ${tableName} AS pets, users_data.users AS users WHERE pets.owner = users.email`
		);
		res.status(200).json(pets.rows);
	} catch (error) {
		res.status(500).send();
		console.error('FETCH PETS ERROR:', error.message, error.code);
	}
});

app.listen(port, () => {
	console.log(`App listening on port ${port}`);
});
