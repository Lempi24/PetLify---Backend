// routes/chats.js
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import authenticateToken from '../tokenAuthorization.js';
import pool from '../database.js';

// Upload zdjęć
import multer from 'multer';
import cloudinary from '../cloudinary.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

export default function chatRouterFactory(io) {
  const router = Router();

  // Idempotentny bootstrap schematu/tabel
  const ensureSchema = async () => {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS chats;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats.threads (
        id UUID PRIMARY KEY,
        subject TEXT,
        pet_id INTEGER NULL,
        owner_email TEXT NOT NULL,
        partner_email TEXT NOT NULL,
        last_message TEXT NULL,
        last_time TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_for_owner BOOLEAN NOT NULL DEFAULT false,
        deleted_for_partner BOOLEAN NOT NULL DEFAULT false
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats.messages (
        id UUID PRIMARY KEY,
        thread_id UUID NOT NULL REFERENCES chats.threads(id) ON DELETE CASCADE,
        sender_email TEXT NOT NULL,
        text TEXT,
        attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='chats' AND table_name='threads' AND column_name='deleted_for_owner'
        ) THEN
          ALTER TABLE chats.threads ADD COLUMN deleted_for_owner BOOLEAN NOT NULL DEFAULT false;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='chats' AND table_name='threads' AND column_name='deleted_for_partner'
        ) THEN
          ALTER TABLE chats.threads ADD COLUMN deleted_for_partner BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END
      $$;
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM   pg_class c
          JOIN   pg_namespace n ON n.oid = c.relnamespace
          WHERE  c.relname = 'uniq_thread_pet_pair'
          AND    n.nspname = 'chats'
        ) THEN
          CREATE UNIQUE INDEX uniq_thread_pet_pair
            ON chats.threads (
              COALESCE(pet_id, 0),
              LEAST(owner_email, partner_email),
              GREATEST(owner_email, partner_email)
            );
        END IF;
      END$$;
    `);
  };
  ensureSchema().catch(console.error);

  // === UPLOAD ZDJĘĆ DO CLOUDINARY ===
  router.post(
    '/upload-image',
    authenticateToken,
    upload.array('images', 10),
    async (req, res) => {
      try {
        if (!req.files || req.files.length === 0) {
          return res.status(400).json({ message: 'Brak plików' });
        }

        const uploads = await Promise.all(
          req.files.map((file) => {
            if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
              const err = new Error('ONLY_IMAGES_ALLOWED');
              err.code = 'ONLY_IMAGES_ALLOWED';
              throw err;
            }

            return new Promise((resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream(
                {
                  folder: 'petlify/chat',
                  resource_type: 'image',
                },
                (error, result) => {
                  if (error || !result) {
                    return reject(error || new Error('UPLOAD_FAILED'));
                  }
                  resolve({
                    id: uuidv4(),
                    name: file.originalname,
                    type: file.mimetype,
                    size: file.size,
                    url: result.secure_url,
                  });
                }
              );
              stream.end(file.buffer);
            });
          })
        );

        return res.json({ attachments: uploads });
      } catch (e) {
        console.error('upload-image error:', e);
        if (e.code === 'ONLY_IMAGES_ALLOWED') {
          return res
            .status(400)
            .json({ message: 'Do czatu można dodać wyłącznie zdjęcia (pliki graficzne).' });
        }
        return res.status(500).json({ message: 'Błąd podczas uploadu zdjęć' });
      }
    }
  );

  // [POST] /chats/ensure-thread
  router.post('/ensure-thread', authenticateToken, async (req, res) => {
    try {
      const me = req.user.email.toLowerCase();
      const { subject = 'Zwierzak', petId = null, ownerEmail, partnerEmail } = req.body;
      if (!ownerEmail || !partnerEmail)
        return res.status(400).json({ message: 'Missing emails' });

      const a = ownerEmail.trim().toLowerCase();
      const b = partnerEmail.trim().toLowerCase();
      const owner = a < b ? a : b;
      const partner = a < b ? b : a;

      const { rows } = await pool.query(
        `
        SELECT * FROM chats.threads
        WHERE COALESCE(pet_id, 0) = COALESCE($1, 0)
          AND LEAST(owner_email, partner_email) = $2
          AND GREATEST(owner_email, partner_email) = $3
        LIMIT 1
        `,
        [petId, owner, partner]
      );

      if (rows[0]) {
        const t = rows[0];
        if (me === t.owner_email && t.deleted_for_owner) {
          const { rows: upd } = await pool.query(
            `UPDATE chats.threads SET deleted_for_owner = false WHERE id = $1 RETURNING *`,
            [t.id]
          );
          return res.json(upd[0]);
        }
        if (me === t.partner_email && t.deleted_for_partner) {
          const { rows: upd } = await pool.query(
            `UPDATE chats.threads SET deleted_for_partner = false WHERE id = $1 RETURNING *`,
            [t.id]
          );
          return res.json(upd[0]);
        }
        return res.json(t);
      }

      const id = uuidv4();
      const created = await pool.query(
        `
        INSERT INTO chats.threads (id, subject, pet_id, owner_email, partner_email)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *
        `,
        [id, subject, petId, owner, partner]
      );
      res.json(created.rows[0]);
    } catch (e) {
      console.error('ensure-thread error:', e);
      res.status(500).send();
    }
  });

  // [GET] /chats/threads
  router.get('/threads', authenticateToken, async (req, res) => {
    try {
      const me = req.user.email.toLowerCase();
      const { rows } = await pool.query(
        `
        SELECT * FROM chats.threads
        WHERE (owner_email = $1 AND deleted_for_owner = false)
           OR (partner_email = $1 AND deleted_for_partner = false)
        ORDER BY COALESCE(last_time, created_at) DESC
        `,
        [me]
      );
      res.json(rows);
    } catch (e) {
      console.error('threads error:', e);
      res.status(500).send();
    }
  });

  // [GET] /chats/:threadId/messages
  router.get('/:threadId/messages', authenticateToken, async (req, res) => {
    try {
      const { threadId } = req.params;
      const me = req.user.email.toLowerCase();

      const { rows: trows } = await pool.query(
        `SELECT owner_email, partner_email, deleted_for_owner, deleted_for_partner
         FROM chats.threads WHERE id = $1`,
        [threadId]
      );
      const t = trows[0];
      if (!t) return res.status(404).send();
      if (
        t.owner_email.toLowerCase() !== me &&
        t.partner_email.toLowerCase() !== me
      ) {
        return res.status(403).send();
      }

      const { rows } = await pool.query(
        `
        SELECT * FROM chats.messages
        WHERE thread_id = $1
        ORDER BY created_at ASC
        `,
        [threadId]
      );
      res.json(rows);
    } catch (e) {
      console.error('messages error:', e);
      res.status(500).send();
    }
  });

  // [POST] /chats/:threadId/message  (TU UŻYWAMY HTTP, NIE socket:send)
  router.post('/:threadId/message', authenticateToken, async (req, res) => {
    try {
      const { threadId } = req.params;
      const { text = '', attachments = [] } = req.body;

      const me = req.user.email.toLowerCase();

      // Tylko obrazki jako załączniki
      const onlyImages =
        Array.isArray(attachments) &&
        attachments.every(
          (a) =>
            a &&
            typeof a.type === 'string' &&
            a.type.toLowerCase().startsWith('image/')
        );
      if (!onlyImages && attachments.length > 0) {
        return res
          .status(400)
          .json({ message: 'Do czatu można dodać wyłącznie zdjęcia (pliki graficzne).' });
      }

      const { rows: trows } = await pool.query(
        `SELECT id, owner_email, partner_email FROM chats.threads WHERE id = $1`,
        [threadId]
      );
      const t = trows[0];
      if (!t) return res.status(404).send();

      if (
        t.owner_email.toLowerCase() !== me &&
        t.partner_email.toLowerCase() !== me
      ) {
        return res.status(403).send();
      }

      const messageId = uuidv4();
      const createdAt = new Date();

      await pool.query(
        `
        INSERT INTO chats.messages (id, thread_id, sender_email, text, attachments, created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [messageId, threadId, me, text, JSON.stringify(attachments || []), createdAt]
      );
      await pool.query(
        `
        UPDATE chats.threads
        SET last_message = $1, last_time = $2
        WHERE id = $3
        `,
        [text || (attachments[0]?.name || 'Załącznik'), createdAt, threadId]
      );

      const payload = {
        id: messageId,
        threadId,
        senderEmail: me,
        text,
        attachments,
        createdAt: createdAt.toISOString(),
      };

      // POWIADOMIENIE WSZYSTKICH W POKOJU
      io.to(`thread:${threadId}`).emit('chat:newMessage', payload);

      res.json(payload);
    } catch (e) {
      console.error('post message error:', e);
      res.status(500).send();
    }
  });

  // [DELETE] /chats/:threadId  -> "usuń dla mnie"
  router.delete('/:threadId', authenticateToken, async (req, res) => {
    try {
      const { threadId } = req.params;
      const me = req.user.email.toLowerCase();

      const { rows: trows } = await pool.query(
        `SELECT id, owner_email, partner_email, deleted_for_owner, deleted_for_partner
         FROM chats.threads WHERE id = $1`,
        [threadId]
      );
      const t = trows[0];
      if (!t) return res.status(404).json({ message: 'Nie znaleziono wątku' });
      if (
        t.owner_email.toLowerCase() !== me &&
        t.partner_email.toLowerCase() !== me
      ) {
        return res.status(403).json({ message: 'Brak uprawnień' });
      }

      if (me === t.owner_email.toLowerCase()) {
        await pool.query(`UPDATE chats.threads SET deleted_for_owner = true WHERE id = $1`, [
          threadId,
        ]);
      } else {
        await pool.query(
          `UPDATE chats.threads SET deleted_for_partner = true WHERE id = $1`,
          [threadId]
        );
      }

      const { rows: chk } = await pool.query(
        `SELECT deleted_for_owner, deleted_for_partner FROM chats.threads WHERE id = $1`,
        [threadId]
      );
      if (chk[0]?.deleted_for_owner && chk[0]?.deleted_for_partner) {
        await pool.query(`DELETE FROM chats.threads WHERE id = $1`, [threadId]);
      }

      io.to(`user:${me}`).emit('chat:notify', { threadId, deleted: true });

      res.json({ ok: true });
    } catch (e) {
      console.error('delete thread error:', e);
      res.status(500).send();
    }
  });

  return router;
}
