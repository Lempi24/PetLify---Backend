import bcrypt from 'bcrypt';
import pool from '../database.js';

// --- Update user info ---
export const updateUserInfo = async (req, res) => {
	try {
		const { email, name, surname, phoneNumber } = req.body;
		await pool.query(
			'UPDATE users_data.users SET first_name = $1, surname = $2, phone = $3 WHERE email = $4',
			[name, surname, phoneNumber, email]
		);
		res.status(200).send({ message: 'Dane zaktualizowane' });
	} catch (error) {
		console.error('UPDATE USER DATA ERROR:', error.message);
		res.status(500).send();
	}
};

// --- Update location ---
export const updateLocation = async (req, res) => {
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
		console.error('UPDATE USER LOCATION ERROR:', error.message);
		res.status(500).send();
	}
};

// --- Update notification settings ---
export const updateNotifications = async (req, res) => {
	try {
		const { notify_new_chats, notify_missing, email } = req.body;

		await pool.query(
			'UPDATE users_data.settings SET notify_new_chats = $1, notify_missing = $2 WHERE email = $3',
			[notify_new_chats, notify_missing, email]
		);

		res.status(200).send({ message: 'Ustawienia zaktualizowane' });
	} catch (error) {
		console.error('UPDATE USER NOTIFICATIONS ERROR:', error.message);
		res.status(500).send();
	}
};

// --- Fetch user settings ---
export const fetchUserSettings = async (req, res) => {
	try {
		const email = req.user.email;
		const settings = await pool.query(
			'SELECT * FROM users_data.settings WHERE email = $1',
			[email]
		);
		res.status(200).json(settings.rows[0]);
	} catch (error) {
		console.error('FETCH USER SETTINGS ERROR:', error.message);
		res.status(500).send();
	}
};

// --- Delete user ---
export const deleteUser = async (req, res) => {
	try {
		const { email } = req.body;
		if (!email) return res.status(400).json({ message: 'Email is required' });

		await pool.query('DELETE FROM users_data.logins WHERE email = $1', [email]);
		await pool.query('DELETE FROM users_data.users WHERE email = $1', [email]);

		res.status(200).json({ message: 'Konto usunięte' });
	} catch (error) {
		console.error('DELETE USER ERROR:', error.message);
		res.status(500).send();
	}
};

// --- Update password ---
export const updatePassword = async (req, res) => {
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
		if (!passwordCheck)
			return res.status(401).send({ message: 'Błędne hasło' });

		const salt = await bcrypt.genSalt();
		const hashedPassword = await bcrypt.hash(newPassword, salt);

		await pool.query(
			'UPDATE users_data.logins SET password = $1 WHERE email = $2',
			[hashedPassword, email]
		);

		res.status(200).send({ message: 'Hasło zaktualizowane' });
	} catch (error) {
		console.error('UPDATE USER PASSWORD ERROR:', error.message);
		res.status(500).send();
	}
};
