import express from 'express';
import authenticateToken from '../tokenAuthorization.js';
import {
  updateUserInfo,
  updateLocation,
  updateNotifications,
  fetchUserSettings,
  deleteUser,
  updatePassword,
} from '../controllers/settingsController.js';
import { createPetProfile, fetchPetProfiles, deletePetProfile } from '../controllers/petProfileController.js';

const router = express.Router();

router.put('/update-user-info', authenticateToken, updateUserInfo);
router.put('/update-location', authenticateToken, updateLocation);
router.put('/notifications', authenticateToken, updateNotifications);
router.get('/fetch-user-settings', authenticateToken, fetchUserSettings);
router.delete('/delete-user', authenticateToken, deleteUser);
router.put('/update-password', authenticateToken, updatePassword);
router.post('/createPetProfile', authenticateToken, createPetProfile);
router.get('/fetchPetProfiles', authenticateToken, fetchPetProfiles);
router.delete('/deletePetProfile', authenticateToken, deletePetProfile);

export default router;
