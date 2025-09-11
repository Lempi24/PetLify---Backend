import { v2 as cloudinary, config } from 'cloudinary';
import 'dotenv/config';

config({
  cloudinary_url: process.env.CLOUDINARY_URL,
});

export default cloudinary;
