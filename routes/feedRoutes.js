import express from 'express';
import { fetchPets } from '../controllers/feedController.js';

const router = express.Router();

router.get('/fetch-pets', fetchPets);

export default router;
