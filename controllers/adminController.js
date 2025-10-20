import pool from '../database.js';

// --- Approve report ---
export const approveReport = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Brak uprawnień administratora' });
  }

  const { reportId, reportType } = req.body;

  if (!reportId || !reportType) {
    return res.status(400).json({ message: 'Report ID i typ są wymagane' });
  }

  try {
    if (reportType === 'lost') {
      await pool.query(
        `UPDATE reports.lost_reports SET status = 'active' WHERE id = $1`,
        [reportId]
      );
    } else if (reportType === 'found') {
      await pool.query(
        `UPDATE reports.found_reports SET status = 'active' WHERE id = $1`,
        [reportId]
      );
    } else {
      return res.status(400).json({ message: 'Niepoprawny typ raportu' });
    }

    res.status(200).json({ message: 'Raport aktywowany' });
  } catch (error) {
    console.error('APPROVE REPORT ERROR:', error.message);
    res.status(500).send();
  }
};

// --- Reject report ---
export const rejectReport = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Brak uprawnień administratora' });
  }

  const { reportId, reportType } = req.body;

  if (!reportId || !reportType) {
    return res.status(400).json({ message: 'Report ID i typ są wymagane' });
  }

  try {
    if (reportType === 'lost') {
      await pool.query(
        `UPDATE reports.lost_reports SET status = 'rejected' WHERE id = $1`,
        [reportId]
      );
    } else if (reportType === 'found') {
      await pool.query(
        `UPDATE reports.found_reports SET status = 'rejected' WHERE id = $1`,
        [reportId]
      );
    } else {
      return res.status(400).json({ message: 'Niepoprawny typ raportu' });
    }

    res.status(200).json({ message: 'Raport odrzucony' });
  } catch (error) {
    console.error('REJECT REPORT ERROR:', error.message);
    res.status(500).send();
  }
};

// --- Manage user permissions ---
export const managePermissions = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Brak uprawnień administratora' });
  }

  const { userEmail, newRole } = req.body;

  if (!userEmail || !newRole) {
    return res.status(400).json({ message: 'Email i rola są wymagane' });
  }

  try {
    const userCheck = await pool.query(
      'SELECT email FROM users_data.users WHERE email = $1',
      [userEmail]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Użytkownik nie istnieje' });
    }

    await pool.query(
      'UPDATE users_data.users SET sys_role = $1 WHERE email = $2',
      [newRole, userEmail]
    );

    res.status(200).json({
      message: `Zaktualizowano uprawnienia dla ${userEmail} → ${newRole}`,
    });
  } catch (error) {
    console.error('MANAGE PERMISSIONS ERROR:', error.message);
    res.status(500).json({ message: 'Błąd serwera podczas aktualizacji uprawnień' });
  }
};
