import pool from '../database.js';

export const fetchPets = async (req, res) => {
	try {
		const { type, status } = req.query;

		const tableMap = {
			lost: 'reports.lost_reports',
			found: 'reports.found_reports',
		};

		const tableName = tableMap[type];
		if (!tableName) {
			return res.status(400).json({ error: 'Invalid type' });
		}

		const dateCol = type === 'lost' ? 'lost_date' : 'found_date';

		const pets = await pool.query(
			`SELECT pets.*, users.phone, pets.id
			 FROM ${tableName} AS pets, users_data.users AS users 
			 WHERE pets.owner = users.email AND pets.status = $1
			 ORDER BY pets.${dateCol} DESC`,
			[status]
		);

		res.status(200).json(pets.rows);
	} catch (error) {
		console.error('FETCH PETS ERROR:', error.message, error.code);
		return res.status(500).json({ error: 'Database error' });
	}
};
