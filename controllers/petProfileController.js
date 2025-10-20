import pool from '../database.js';

export const createPetProfile = async (req, res) => {
  try {
    const { petId, user, petName, petAge, petSize, petSpecies, petBreed, petColor, photoUrl } = req.body;

    const existingPetProfile = await fetchPetProfile(req, res);

    if (existingPetProfile) {
      return res.status(400).json({ message: 'Pet profile already exists for this user' });
    }
    
    await pool.query(
      `INSERT INTO pets_info.pet_profiles (id, owner, pet_name, pet_age, pet_size, pet_species_type, pet_breed, pet_color, photo_url) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [petId, user, petName, petAge, petSize, petSpecies, petBreed, petColor, photoUrl]
    );

    res.status(200).json({ message: 'Pet profile created successfully' });
  } catch (error) {
    console.error('Error creating pet profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const fetchPetProfile = async (req, res) => {
    const { userEmail } = req.body;
    
    try {
        const { rows } = await pool.query(
            `SELECT * FROM pets_info.pet_profiles WHERE owner = $1`,
            [userEmail]
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('FETCH PET PROFILE ERROR:', error.message);
        res.status(500).send();
    }
};
