import express from 'express';
import { getMe, register, login } from '../controllers/authController.js';
const router = express.Router();

router.get('/me', getMe);
router.post('/register', register);
router.post('/login', login);

export default router;
