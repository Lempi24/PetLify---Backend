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
const photoUpload = multer({ 
    dest: './uploads',
    fileFilter: (req, file, cb) => {
        console.log('Multer processing file:', file.originalname);
        console.log('Auth header after multer:', req.headers.authorization);
        cb(null, true);
    }
});

// Found report
router.post(
	'/create-found-form',
	authenticateToken,
	photoUpload.array('photos', 5),
	createFoundForm
);

// Lost report
router.post(
	'/create-lost-form',
	authenticateToken,
	photoUpload.array('photos', 5),
	createLostForm
);

// User reports
router.get('/fetch-reports', authenticateToken, fetchUserReports);
//Edit report
router.put('/edit-report', authenticateToken, editReport);
export default router;
