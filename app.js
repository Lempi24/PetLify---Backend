import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import pool from './database.js';
import cloudinary from './cloudinary.js';
import authenticateToken from './tokenAuthorization.js';
import './jobsDB.js';

//Routy
import chatRouterFactory from './routes/chats.js';
import authRoutes from './routes/authRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import reportsRoutes from './routes/reportsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import feedRoutes from './routes/feedRoutes.js';
import petProfilesRoutes from './routes/petProfilesRoutes.js';

const app = express();
const server = http.createServer(app);

// --- CORS ---
const FRONT_ORIGIN = process.env.FRONT_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: FRONT_ORIGIN, credentials: true }));
app.use(express.json());

// --- Socket.IO (JWT autoryzacja) ---
const io = new SocketIOServer(server, {
	cors: { origin: FRONT_ORIGIN, methods: ['GET', 'POST'] },
});

io.use((socket, next) => {
	try {
		const token =
			socket.handshake.auth?.token ||
			socket.handshake.headers?.authorization?.split(' ')[1];
		if (!token) return next(new Error('No token'));
		const user = jwt.verify(token, process.env.ACCESS_SECRET_TOKEN);
		socket.user = user; // {email}
		next();
	} catch (e) {
		next(new Error('Unauthorized'));
	}
});

io.on('connection', (socket) => {
	const email = socket.user?.email;
	if (email) {
		// pokój użytkownika (powiadomienia)
		socket.join(`user:${email}`);
	}

	// dołączanie do pokoju konkretnego wątku
	socket.on('chat:join', ({ threadId }) => {
		if (!threadId) return;
		socket.join(`thread:${threadId}`);
	});

	// wysłanie wiadomości (zapis + broadcast)
	socket.on('chat:send', async ({ threadId, text = '', attachments = [] }) => {
		try {
			if (!threadId || (!text && attachments.length === 0)) return;

			const { rows: trows } = await pool.query(
				'SELECT id, owner_email, partner_email FROM chats.threads WHERE id = $1',
				[threadId]
			);
			const thread = trows[0];
			if (!thread) return;

			const messageId = uuidv4();
			const createdAt = new Date();

			await pool.query(
				`INSERT INTO chats.messages (id, thread_id, sender_email, text, attachments, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
				[
					messageId,
					threadId,
					socket.user.email,
					text,
					JSON.stringify(attachments || []),
					createdAt,
				]
			);

			await pool.query(
				`UPDATE chats.threads
           SET last_message = $1, last_time = $2
         WHERE id = $3`,
				[text || attachments[0]?.name || 'Załącznik', createdAt, threadId]
			);

			const payload = {
				id: messageId,
				threadId,
				senderEmail: socket.user.email,
				text,
				attachments,
				createdAt: createdAt.toISOString(),
			};

			// do wszystkich uczestników wątku
			io.to(`thread:${threadId}`).emit('chat:newMessage', payload);

			// powiadomienia na poziomie user-room
			io.to(`user:${thread.owner_email}`).emit('chat:notify', {
				threadId,
				preview: payload,
			});
			io.to(`user:${thread.partner_email}`).emit('chat:notify', {
				threadId,
				preview: payload,
			});
		} catch (err) {
			console.error('SOCKET send error:', err.message);
		}
	});
});

app.use('/auth', authRoutes);
//settings
app.use('/settings', settingsRoutes);
// reports
app.use('/reports', reportsRoutes);
//admin stuff
app.use('/admin-panel', adminRoutes);
//feed na stronie głównej
app.use('/main-page', feedRoutes);

app.use('/pet-profiles', petProfilesRoutes);

// ====== ROUTES: CHATS (NOWE) ======
app.use('/chats', chatRouterFactory(io));

// ====== START ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`App + Socket.IO listening on :${PORT}`));
