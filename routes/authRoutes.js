import express from 'express';
import {
	getMe,
	register,
	login,
	verifyEmail,
} from '../controllers/authController.js';

const router = express.Router();

// GET info o aktualnym userze
router.get('/me', getMe);

// REJESTRACJA / LOGOWANIE
router.post('/register', register);
router.post('/login', login);

// WERYFIKACJA MAILA
router.get('/verify', verifyEmail); // user kliknie link w mailu

export default router;
