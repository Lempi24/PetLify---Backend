import express from 'express';
import authenticateToken from '../tokenAuthorization.js';
import {
  approveReport,
  rejectReport,
  managePermissions,
} from '../controllers/adminController.js';

const router = express.Router();

router.post('/approve-report', authenticateToken, approveReport);
router.post('/reject-report', authenticateToken, rejectReport);
router.post('/manage-permissions', authenticateToken, managePermissions);

export default router;
