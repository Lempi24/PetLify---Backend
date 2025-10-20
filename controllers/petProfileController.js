import pool from '../database.js';
import cloudinary from '../cloudinary.js';
import fs from 'fs';

const getUserPetProfiles = async (email) => {
    const { rows } = await pool.query(
        `SELECT * FROM pets_info.pet_profiles WHERE owner = $1`,
        [email]
    );
    return rows;
};

export const createPetProfile = async (req, res) => {
    try {
        const { user } = req.user;
        const { petId, petName, petAge, petSize, petSpecies, petBreed, petColor } = req.body;

        const existingPetProfiles = await getUserPetProfiles(user.email);
        if (existingPetProfiles.length >= 3) {
            return res.status(400).json({ message: 'Limit 3 profili zwierząt został osiągnięty' });
        }

        let photo_urls = [];

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'Brak przesłanych zdjęć' });
        }

        if (req.files.length > 5) {
            req.files.forEach((f) => fs.unlinkSync(f.path));
            return res.status(400).json({ message: 'Można przesłać maksymalnie 5 zdjęć' });
        }

        const results = await Promise.all(
            req.files.map((file) =>
                cloudinary.uploader.upload(file.path, { folder: 'pet_profiles_photos' })
            )
        );
        photo_urls = results.map((r) => r.secure_url);

        req.files.forEach((f) => fs.unlinkSync(f.path));

        await pool.query(
            `INSERT INTO pets_info.pet_profiles 
            (id, owner, pet_name, pet_age, pet_size, pet_species_type, pet_breed, pet_color, photo_url) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                petId,
                user.email,
                petName,
                petAge,
                petSize,
                petSpecies,
                petBreed,
                petColor,
                photo_urls
            ]
        );

        res.status(201).json({ message: 'Profil zwierzęcia został utworzony' });
    } catch (error) {
        console.error('Error creating pet profile:', error);
        
        if (req.files) req.files.forEach((f) => fs.unlinkSync(f.path));
        res.status(500).json({ message: 'Wewnętrzny błąd serwera' });
    }
};

export const fetchPetProfiles = async (req, res) => {
    const { user } = req.user;

    try {
        const rows = await getUserPetProfiles(user.email);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Brak profili zwierząt dla tego użytkownika' });
        }

        res.status(200).json(rows);
    } catch (error) {
        console.error('FETCH PET PROFILE ERROR:', error.message);
        res.status(500).json({ message: 'Błąd pobierania profili' });
    }
};

export const deletePetProfile = async (req, res) => {
    const { petId } = req.body;

    try {
        await pool.query(
            `DELETE FROM pets_info.pet_profiles WHERE id = $1`,
            [petId]
        );
        res.status(200).json({ message: 'Profil zwierzęcia został usunięty' });
    } catch (error) {
        console.error('Error deleting pet profile:', error);
        res.status(500).json({ message: 'Błąd usuwania profilu' });
    }
};
