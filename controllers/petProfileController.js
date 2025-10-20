import pool from '../database.js';
import cloudinary from '../cloudinary.js';
import fs from 'fs';

export const createPetProfile = async (req, res) => {
  try {
    const { user } = req.user;
    const { petId, petName, petAge, petSize, petSpecies, petBreed, petColor } = req.body;

    const existingPetProfiles = await fetchPetProfile(req, res);

    if (existingPetProfiles && existingPetProfiles.length > 2) {
      return res.status(400).json({ message: 'User has reached the maximum number of pet profiles' });
    }

    let photo_urls = [];

    if (req.files.length > 5) {
        return res.status(400).json({ message: 'You can upload up to 5 photos only' });
    }

    if (req.files && req.files.length > 0) {
        const results = await Promise.all(
            req.files.map((file) =>
                cloudinary.uploader.upload(file.path, { folder: 'pet_profiles_photos' })
            )
        );
        photo_urls = results.map((r) => r.secure_url);
        req.files.forEach((f) => fs.unlinkSync(f.path));
    } else {
        return res.status(400).send('No photo uploaded');
    }
    
    await pool.query(
      `INSERT INTO pets_info.pet_profiles (id, owner, pet_name, pet_age, pet_size, pet_species_type, pet_breed, pet_color, photo_url) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [petId, user.email, petName, petAge, petSize, petSpecies, petBreed, petColor, photo_urls]
    );

    res.status(200).json({ message: 'Pet profile created successfully' });
  } catch (error) {
    console.error('Error creating pet profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const fetchPetProfile = async (req, res) => {
    const { user } = req.user;
    
    try {
        const { rows } = await pool.query(
            `SELECT * FROM pets_info.pet_profiles WHERE owner = $1`,
            [user.email]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'No pet profiles found for this user' });
        }

        res.status(200).json(rows);
    } catch (error) {
        console.error('FETCH PET PROFILE ERROR:', error.message);
        res.status(500).send();
    }
};

export const deletePetProfile = async (req, res) => {
    const { petId } = req.body;

    try {
        await pool.query(
            `DELETE FROM pets_info.pet_profiles WHERE id = $1`,
            [petId]
        );
        res.status(200).json({ message: 'Pet profile deleted successfully' });
    } catch (error) {
        console.error('Error deleting pet profile:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
