import express from 'express';
import { fetchPets, fetchPetById } from '../controllers/feedController.js';

const router = express.Router();

router.get('/fetch-pets', fetchPets);
router.get('/fetch-pet/:id', fetchPetById);
export default router;
