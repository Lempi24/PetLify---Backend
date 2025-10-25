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
        const user = req.user;
        const { petName, petAge, petSize, petSpecies, petBreed, petColor } = req.body;

        if (!user || !user.email) {
            return res.status(400).json({ message: 'Brak adresu email użytkownika' });
        }

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
            (owner, pet_name, pet_age, pet_size, pet_species_type, pet_breed, pet_color, photo_url) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
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
    console.log('Req.user w fetchPetProfiles:', req.user);
    
    const user = req.user;
    
    if (!user || !user.email) {
        console.error('User or user email not found in fetchPetProfiles:', req.user);
        return res.status(400).json({ message: 'Brak adresu email użytkownika' });
    }

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

export const updatePetProfile = async (req, res) => {
    console.log('=== UPDATE PET PROFILE REQUEST ===');
    console.log('Body:', req.body);
    console.log('Files:', req.files);
    console.log('User:', req.user);
    
    try {
        const user = req.user;
        const { petId, petName, petAge, petSize, petSpecies, petBreed, petColor, existingPhotos } = req.body;

        console.log('Parsed data:', { petId, petName, petAge, petSize, petSpecies, petBreed, petColor, existingPhotos });

        if (!user || !user.email) {
            console.error('No user or email found');
            return res.status(400).json({ message: 'Brak adresu email użytkownika' });
        }

        if (!petId) {
            console.error('No petId provided');
            return res.status(400).json({ message: 'Brak ID profilu zwierzęcia' });
        }

        const existingProfile = await pool.query(
            `SELECT * FROM pets_info.pet_profiles WHERE id = $1 AND owner = $2`,
            [petId, user.email]
        );

        if (existingProfile.rows.length === 0) {
            console.error('Pet profile not found for user:', { petId, user: user.email });
            return res.status(404).json({ message: 'Profil zwierzęcia nie znaleziony' });
        }

        let photo_urls = [];
        
        if (existingPhotos) {
            if (Array.isArray(existingPhotos)) {
                photo_urls = existingPhotos;
            } else if (typeof existingPhotos === 'string') {
                photo_urls = [existingPhotos];
            }
            console.log('Existing photos:', photo_urls);
        }

        if (req.files && req.files.length > 0) {
            console.log('Processing new files:', req.files.length);
            
            if (req.files.length + photo_urls.length > 5) {
                req.files.forEach((f) => fs.unlinkSync(f.path));
                return res.status(400).json({ message: 'Można przesłać maksymalnie 5 zdjęć' });
            }

            const results = await Promise.all(
                req.files.map((file) =>
                    cloudinary.uploader.upload(file.path, { folder: 'pet_profiles_photos' })
                )
            );
            const newPhotoUrls = results.map((r) => r.secure_url);
            photo_urls = [...photo_urls, ...newPhotoUrls];

            req.files.forEach((f) => fs.unlinkSync(f.path));
        }

        if (photo_urls.length > 5) {
            photo_urls = photo_urls.slice(0, 5);
        }

        console.log('Final photo URLs:', photo_urls);

        const updateQuery = `
            UPDATE pets_info.pet_profiles 
            SET pet_name = $1, pet_age = $2, pet_size = $3, pet_species_type = $4, 
                pet_breed = $5, pet_color = $6, photo_url = $7, updated_at = CURRENT_TIMESTAMP
            WHERE id = $8 AND owner = $9
        `;

        console.log('Executing update query:', updateQuery);
        console.log('With values:', [petName, petAge, petSize, petSpecies, petBreed, petColor, photo_urls, petId, user.email]);

        const result = await pool.query(updateQuery, [
            petName,
            petAge,
            petSize,
            petSpecies,
            petBreed,
            petColor,
            photo_urls,
            petId,
            user.email
        ]);

        console.log('Update result:', result);

        res.status(200).json({ message: 'Profil zwierzęcia został zaktualizowany' });
    } catch (error) {
        console.error('Error updating pet profile:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            detail: error.detail
        });
        
        if (req.files) req.files.forEach((f) => fs.unlinkSync(f.path));
        res.status(500).json({ message: 'Wewnętrzny błąd serwera: ' + error.message });
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