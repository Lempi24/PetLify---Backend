import pool from '../database.js';

export const fetchPets = async (req, res) => {
  try {
    const {
      type,        // 'lost' | 'found' (wymagane)
      status,      // np. 'active'
      species,     // kod systemowy: 'dog' | 'cat' | ...
      breed,       // fragment (ILIKE)
      cityStreet,  // np. "Poznań, Zwierzyniecka"
      ageFrom,     // int >= 1
      ageTo,       // int >= 1
      ageUnit,     // 'years' | 'months' (domyślnie 'years')
      sort,        // newest|oldest|age_desc|age_asc
      page,        // numer strony (1..)
      limit,       // ile na stronę
    } = req.query;

    const tableMap = { lost: 'reports.lost_reports', found: 'reports.found_reports' };
    const tableName = tableMap[type];
    if (!tableName) return res.status(400).json({ error: 'Invalid type' });

    const dateCol = type === 'lost' ? 'lost_date' : 'found_date';

    // ---------- Budowanie filtrów (wspólne dla zapytań COUNT i SELECT) ----------
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

    // ---- WIEK: ujednolicenie do miesięcy ----
    const ageNumExpr = `
      CAST(
        REPLACE(
          substring(pets.pet_age from '([0-9]+(?:[.,][0-9]+)?)'),
          ',', '.'
        ) AS numeric
      )
    `;

    const ageInMonthsExpr = `
      CASE
        WHEN pets.pet_age ILIKE '%mies%' OR pets.pet_age ILIKE '%msc%'
          THEN ${ageNumExpr}
        ELSE (${ageNumExpr}) * 12
      END
    `;

    const parseIntOrNull = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 ? n : null;
    };

    const unit = (ageUnit || 'years').toLowerCase() === 'months' ? 'months' : 'years';
    const aFrom = parseIntOrNull(ageFrom);
    const aTo = parseIntOrNull(ageTo);

    const toMonths = (val) => (val === null ? null : (unit === 'months' ? val : val * 12));
    const aFromMonths = toMonths(aFrom);
    const aToMonths = toMonths(aTo);

    if (aFromMonths !== null) {
      params.push(aFromMonths);
      where.push(`(${ageInMonthsExpr}) >= $${params.length}`);
    }
    if (aToMonths !== null) {
      params.push(aToMonths);
      where.push(`(${ageInMonthsExpr}) <= $${params.length}`);
    }

    // SORTOWANIE
    let orderBy = `pets.${dateCol} DESC`;
    switch ((sort || '').toLowerCase()) {
      case 'oldest':
        orderBy = `pets.${dateCol} ASC`;
        break;
      case 'age_desc':
        orderBy = `(${ageInMonthsExpr}) DESC NULLS LAST`;
        break;
      case 'age_asc':
        orderBy = `(${ageInMonthsExpr}) ASC NULLS FIRST`;
        break;
      case 'newest':
      default:
        orderBy = `pets.${dateCol} DESC`;
    }

    // PAGINACJA (domyślnie 3 na stronę, max 50)
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.max(1, Math.min(50, parseInt(limit, 10) || 3));
    const offset = (pageNum - 1) * pageSize;

    // ---------- COUNT (ile rekordów spełnia warunki) ----------
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM ${tableName} AS pets
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = countRows?.[0]?.total ?? 0;

    // ---------- Właściwe SELECT z limitem ----------
    const itemsSql = `
      SELECT pets.*, users.phone, pets.id
      FROM ${tableName} AS pets
      JOIN users_data.users AS users
        ON pets.owner = users.email
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;
    const itemsParams = [...params, pageSize, offset];
    const { rows: items } = await pool.query(itemsSql, itemsParams);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    res.status(200).json({
      items,
      total,
      page: pageNum,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error('FETCH PETS ERROR:', error.message, error.code);
    res.status(500).json({ error: 'Database error' });
  }
};
