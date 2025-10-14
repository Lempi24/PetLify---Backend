import express from 'express';
import multer from 'multer';
import authenticateToken from '../tokenAuthorization.js';
import {
	createLostForm,
	createFoundForm,
	fetchUserReports,
	editReport,
} from '../controllers/reportsController.js';

const router = express.Router();
const photoUpload = multer({ dest: './uploads' });

// Lost report
router.post(
	'/create-lost-form',
	authenticateToken,
	photoUpload.array('photos', 5),
	createLostForm
);

// Found report
router.post(
	'/create-found-form',
	authenticateToken,
	photoUpload.array('photos', 5),
	createFoundForm
);

// User reports
router.get('/fetch-reports', authenticateToken, fetchUserReports);
//Edit report
router.put('/edit-report', authenticateToken, editReport);
export default router;
