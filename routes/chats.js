// routes/chats.js
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import authenticateToken from '../tokenAuthorization.js';
import pool from '../database.js';

export default function chatRouterFactory(io) {
  const router = Router();

  // Tworzenie schematu/tabel przy starcie (idempotentne)
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

    // Ten indeks zapewnia unikalność pary (pet + uporządkowane maile)
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

  // [POST] /chats/ensure-thread
  // body: { subject, petId, ownerEmail, partnerEmail }
  router.post('/ensure-thread', authenticateToken, async (req, res) => {
    try {
      const { subject = 'Zwierzak', petId = null, ownerEmail, partnerEmail } = req.body;
      if (!ownerEmail || !partnerEmail) return res.status(400).json({ message: 'Missing emails' });

      // porządek pary (a..b)
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

      if (rows[0]) return res.json(rows[0]);

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

  // [GET] /chats/threads  -> lista wątków użytkownika
  router.get('/threads', authenticateToken, async (req, res) => {
    try {
      const me = req.user.email.toLowerCase();
      const { rows } = await pool.query(
        `
        SELECT * FROM chats.threads
        WHERE owner_email = $1 OR partner_email = $1
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

      // kontrola dostępu — tylko uczestnik
      const me = req.user.email.toLowerCase();
      const { rows: trows } = await pool.query(
        `SELECT owner_email, partner_email FROM chats.threads WHERE id = $1`,
        [threadId]
      );
      const t = trows[0];
      if (!t) return res.status(404).send();
      if (t.owner_email !== me && t.partner_email !== me) return res.status(403).send();

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

  // [POST] /chats/:threadId/message  (HTTP fallback / początkowe wysłanie)
  router.post('/:threadId/message', authenticateToken, async (req, res) => {
    try {
      const { threadId } = req.params;
      const { text = '', attachments = [] } = req.body;

      // kontrola dostępu — tylko uczestnik
      const me = req.user.email.toLowerCase();
      const { rows: trows } = await pool.query(
        `SELECT id, owner_email, partner_email FROM chats.threads WHERE id = $1`,
        [threadId]
      );
      const t = trows[0];
      if (!t) return res.status(404).send();
      if (t.owner_email !== me && t.partner_email !== me) return res.status(403).send();

      const messageId = uuidv4();
      const createdAt = new Date();

      await pool.query(
        `
        INSERT INTO chats.messages (id, thread_id, sender_email, text, attachments, created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [messageId, threadId, req.user.email, text, JSON.stringify(attachments || []), createdAt]
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
        senderEmail: req.user.email,
        text,
        attachments,
        createdAt: createdAt.toISOString(),
      };

      io.to(`thread:${threadId}`).emit('chat:newMessage', payload);

      res.json(payload);
    } catch (e) {
      console.error('post message error:', e);
      res.status(500).send();
    }
  });

  // [DELETE] /chats/:threadId  -> usuń cały wątek (tylko uczestnik)
  router.delete('/:threadId', authenticateToken, async (req, res) => {
    try {
      const { threadId } = req.params;
      const me = req.user.email.toLowerCase();

      const { rows: trows } = await pool.query(
        `SELECT id, owner_email, partner_email FROM chats.threads WHERE id = $1`,
        [threadId]
      );
      const t = trows[0];
      if (!t) return res.status(404).json({ message: 'Nie znaleziono wątku' });
      if (t.owner_email !== me && t.partner_email !== me) {
        return res.status(403).json({ message: 'Brak uprawnień' });
      }

      await pool.query(`DELETE FROM chats.threads WHERE id = $1`, [threadId]); // CASCADE usuwa wiadomości

      // sygnał dla drugiej strony (opcjonalne odświeżenie listy)
      io.to(`user:${t.owner_email}`).emit('chat:notify', { threadId, deleted: true });
      io.to(`user:${t.partner_email}`).emit('chat:notify', { threadId, deleted: true });

      res.json({ ok: true });
    } catch (e) {
      console.error('delete thread error:', e);
      res.status(500).send();
    }
  });

  return router;
}
