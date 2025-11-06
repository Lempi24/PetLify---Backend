import { createPetProfile, fetchPetProfiles, updatePetProfile, deletePetProfile } from '../controllers/petProfileController.js';
import express from 'express';
import multer from 'multer';
import authenticateToken from '../tokenAuthorization.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  }
});

router.post('/createPetProfile', authenticateToken, upload.array('photos', 5), createPetProfile);
router.get('/fetchPetProfiles', authenticateToken, fetchPetProfiles);
router.put('/updatePetProfile', authenticateToken, upload.array('photos', 5), updatePetProfile);
router.delete('/deletePetProfile', authenticateToken, deletePetProfile);

export default router;