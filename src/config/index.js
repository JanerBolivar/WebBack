import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 3000;
export const SECRET_KEY = process.env.SECRET_KEY;

export const API_KEY = process.env.FB_APIKEY;
export const AUTH_DOMAIN = process.env.FB_AUTHDOMAIN;
export const PROJECT_ID = process.env.FB_PROJECTID;
export const STORAGE_BUCKET = process.env.FB_STORAGEBUCKET;
export const MESSAGING_SENDER_ID = process.env.FB_MESSAGINGSENDERID;
export const APP_ID = process.env.FB_APPID;
export const MEASUREMENT_ID = process.env.FB_MEASUREMENTID;
export const DATABASE_URL = process.env.FB_DATABASEURL;
