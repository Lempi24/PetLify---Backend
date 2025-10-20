import express from 'express';
import authenticateToken from '../tokenAuthorization.js';
import { createPetProfile, fetchPetProfiles, deletePetProfile } from '../controllers/petProfileController.js';

const router = express.Router();

router.post('/createPetProfile', authenticateToken, createPetProfile);
router.get('/fetchPetProfiles', authenticateToken, fetchPetProfiles);
router.delete('/deletePetProfile', authenticateToken, deletePetProfile);

export default router;