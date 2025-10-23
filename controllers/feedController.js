import pool from '../database.js';

export const fetchPets = async (req, res) => {
  try {
    const {
      type,        
      status,     
      species,    
      breed,       
      cityStreet,   
      ageFrom,     
      ageTo,       
      sort,        
    } = req.query;

    const tableMap = { lost: 'reports.lost_reports', found: 'reports.found_reports' };
    const tableName = tableMap[type];
    if (!tableName) return res.status(400).json({ error: 'Invalid type' });

    const dateCol = type === 'lost' ? 'lost_date' : 'found_date';

    const where = [];
    const params = [];

    if (status) {
      params.push(status);
      where.push(`pets.status = $${params.length}`);
    }
    if (species) {
      params.push(species);
      where.push(`pets.pet_species = $${params.length}`);
    }
    if (breed) {
      params.push(`%${breed}%`);
      where.push(`pets.pet_breed ILIKE $${params.length}`);
    }

    // LOKALIZACJA: "Miasto, Ulica" => AND; jeden token => OR
    if (cityStreet && cityStreet.trim() !== '') {
      const parts = cityStreet.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        params.push(`%${parts[0]}%`);
        const pCity = `$${params.length}`;
        params.push(`%${parts[1]}%`);
        const pStreet = `$${params.length}`;
        where.push(`(pets.city ILIKE ${pCity} AND pets.street ILIKE ${pStreet})`);
      } else if (parts.length === 1) {
        params.push(`%${parts[0]}%`);
        const p1 = `$${params.length}`;
        where.push(`(pets.city ILIKE ${p1} OR pets.street ILIKE ${p1})`);
      }
    }

    // WIEK => wyciągamy pierwszą liczbę (obsługa 0,5 / 1-3 itp.)
    const ageExpr = `
      CAST(
        REPLACE(
          substring(pets.pet_age from '([0-9]+(?:[.,][0-9]+)?)'),
          ',', '.'
        ) AS numeric
      )
    `;

    // Przyjmujemy tylko całkowite >= 1 z query
    const parseIntOrNull = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 ? n : null;
    };

    const aFrom = parseIntOrNull(ageFrom);
    const aTo   = parseIntOrNull(ageTo);

    if (aFrom !== null) { params.push(aFrom); where.push(`(${ageExpr}) >= $${params.length}`); }
    if (aTo   !== null) { params.push(aTo);   where.push(`(${ageExpr}) <= $${params.length}`); }

    // SORTOWANIE
    let orderBy = `pets.${dateCol} DESC`;
    switch ((sort || '').toLowerCase()) {
      case 'oldest':   orderBy = `pets.${dateCol} ASC`; break;
      case 'age_desc': orderBy = `(${ageExpr}) DESC NULLS LAST`; break;
      case 'age_asc':  orderBy = `(${ageExpr}) ASC NULLS FIRST`; break;
      case 'newest':
      default:         orderBy = `pets.${dateCol} DESC`;
    }

    const sql = `
      SELECT pets.*, users.phone, pets.id
      FROM ${tableName} AS pets
      JOIN users_data.users AS users
        ON pets.owner = users.email
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT 200
    `;

    const { rows } = await pool.query(sql, params);
    res.status(200).json(rows);
  } catch (error) {
    console.error('FETCH PETS ERROR:', error.message, error.code);
    res.status(500).json({ error: 'Database error' });
  }
};
