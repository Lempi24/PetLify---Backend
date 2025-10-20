import express from 'express';
import { createPetProfile, fetchPetProfile } from '../controllers/petProfileController.js';

const router = express.Router();

router.post('/createPetProfile', createPetProfile);
router.get('/fetchPetProfile', fetchPetProfile);

export default router;