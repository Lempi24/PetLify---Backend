// Connection to db

import pg from 'pg';
import 'dotenv/config';
const { Pool } = pg;

const pool = new Pool({
	host: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	ssl: {
		rejectUnauthorized: false,
	},
});

export default pool;
