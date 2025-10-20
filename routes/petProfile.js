import express from 'express';
import authenticateToken from '../tokenAuthorization.js';
import { createPetProfile, fetchPetProfile, deletePetProfile } from '../controllers/petProfileController.js';

const router = express.Router();

router.post('/createPetProfile', authenticateToken, createPetProfile);
router.get('/fetchPetProfile', authenticateToken, fetchPetProfile);
router.delete('/deletePetProfile', authenticateToken, deletePetProfile);

export default router;