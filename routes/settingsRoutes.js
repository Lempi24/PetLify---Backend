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

const router = express.Router();

router.put('/update-user-info', authenticateToken, updateUserInfo);
router.put('/update-location', authenticateToken, updateLocation);
router.put('/notifications', authenticateToken, updateNotifications);
router.get('/fetch-user-settings', authenticateToken, fetchUserSettings);
router.delete('/delete-user', authenticateToken, deleteUser);
router.put('/update-password', authenticateToken, updatePassword);

export default router;
