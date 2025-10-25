import fs from 'fs';
import pool from '../database.js';
import cloudinary from '../cloudinary.js';

export const createLostForm = async (req, res) => {
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

		const { rows } = await pool.query(
			'SELECT COUNT(*) FROM reports.lost_reports WHERE owner = $1',
			[user.email]
		);
		if (parseInt(rows[0].count) >= 3)
			return res.status(401).send('Limit 3 zgłoszeń osiągnięty');

		let photo_urls = [];
		if (req.files && req.files.length > 0) {
			const results = await Promise.all(
				req.files.map((file) =>
					cloudinary.uploader.upload(file.path, { folder: 'lost_pets_photos' })
				)
			);
			photo_urls = results.map((r) => r.secure_url);
			req.files.forEach((f) => fs.unlinkSync(f.path));
		} else {
			return res.status(400).send('Brak wymaganego zdjęcia');
		}

		const [lat, lng] = lostCoordinates.split(',').map(Number);

		await pool.query(
			`INSERT INTO reports.lost_reports 
       (owner, phone, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size, 
        lost_date, city, street, coordinates, description, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,POINT($12,$13),$14,$15)`,
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
		console.error('CREATE LOST FORM ERROR:', err.message);
		if (req.files) req.files.forEach((f) => fs.unlinkSync(f.path));
		res.status(500).send('Błąd serwera');
	}
};

export const createFoundForm = async (req, res) => {
	try {
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
			description,
		} = req.body;

		const { rows } = await pool.query(
			'SELECT COUNT(*) FROM reports.found_reports WHERE owner = $1',
			[user.email]
		);
		if (parseInt(rows[0].count) >= 3)
			return res.status(401).send('Limit 3 zgłoszeń osiągnięty');

		let photo_urls = [];
		if (req.files && req.files.length > 0) {
			const results = await Promise.all(
				req.files.map((file) =>
					cloudinary.uploader.upload(file.path, { folder: 'found_pets_photos' })
				)
			);
			photo_urls = results.map((r) => r.secure_url);
			req.files.forEach((f) => fs.unlinkSync(f.path));
		} else {
			return res.status(400).send('Brak wymaganego zdjęcia');
		}

		const [lat, lng] = foundCoordinates.split(',').map(Number);

		await pool.query(
			`INSERT INTO reports.found_reports 
       (owner, phone, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size,
        found_date, city, street, coordinates, description, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,POINT($12,$13),$14,$15)`,
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
		console.error('CREATE FOUND FORM ERROR:', err.message);
		if (req.files) req.files.forEach((f) => fs.unlinkSync(f.path));
		res.status(500).send('Błąd serwera');
	}
};

export const fetchUserReports = async (req, res) => {
	try {
		const email = req.user?.email;
		if (!email) return res.status(401).json({ error: 'Unauthorized' });

		const lostSql = `
			SELECT id, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size,
					lost_date, city, street, owner, photo_url, description, phone
			FROM reports.lost_reports
			WHERE owner = $1
			ORDER BY lost_date DESC
		`;

		const foundSql = `
			SELECT id, pet_species, pet_breed, pet_color, pet_name, pet_age, pet_size,
					found_date, city, street, owner, photo_url, description, phone
			FROM reports.found_reports
			WHERE owner = $1
			ORDER BY found_date DESC
			`;

		const [lostResult, foundResult] = await Promise.all([
			pool.query(lostSql, [email]),
			pool.query(foundSql, [email]),
		]);

		return res.json({
			lost: lostResult.rows,
			found: foundResult.rows,
		});
	} catch (err) {
		console.error('USER REPORTS FETCH ERROR:', err.message);
		res.status(500).json({ error: 'Database error' });
	}
};
