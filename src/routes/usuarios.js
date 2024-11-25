import { Router } from "express";
import { auth, database } from "../firebase-config.js";
import { DATABASE_URL, SECRET_KEY } from "../config/index.js";
import { ref, ref as dbRef, set, get, update, remove } from "firebase/database";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import multer from "multer";
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';

import credentialsAPI from "../config/env.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail
} from "firebase/auth";

admin.initializeApp({
    credential: admin.credential.cert(credentialsAPI),
    databaseURL: DATABASE_URL
});


// Configuración de multer para manejar las imágenes
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });


const userRouter = Router();

const firebaseStorage = getStorage();

// Ruta para crear usuarios (Registro)
userRouter.post('/register', upload.single('photo'), async (req, res) => {
    const { firstName, lastName, email, password, role } = req.body;
    const photoFile = req.file; // Obtener el archivo de imagen

    try {
        if (!firstName || !lastName || !email || !password || !photoFile || !role) {
            return res.status(400).json({ message: 'Faltan datos requeridos' });
        }

        const validRoles = ['administrador', 'investigador', 'colaborador'];
        if (!validRoles.includes(role.toLowerCase())) {
            return res.status(400).json({ message: 'Rol no válido' });
        }

        // Crear el usuario en Firebase Authentication
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Crear una referencia a Firebase Storage
        const userPhotoRef = storageRef(firebaseStorage, `users/${user.uid}/profile.jpg`);

        // Subir el archivo de imagen
        await uploadBytes(userPhotoRef, photoFile.buffer);

        // Obtener la URL de la imagen subida
        const photoURL = await getDownloadURL(userPhotoRef);

        // Guardar el usuario en la base de datos
        await set(dbRef(database, `users/${user.uid}`), {
            firstName,
            lastName,
            email,
            photoURL,
            role: role.toLowerCase(),
            status: 'active'
        });

        // Generar token JWT con duración de 1 hora
        const token = jwt.sign({
            uid: user.uid,
            email,
            firstName,
            lastName,
            photoURL,
            role: role.toLowerCase()
        }, SECRET_KEY, {
            expiresIn: '1h' // Token válido por 1 hora
        });

        // Decodificar el token para obtener la fecha de expiración
        const decodedToken = jwt.verify(token, SECRET_KEY);
        const expirationDate = decodedToken.exp * 1000;

        // Enviar la información al cliente
        res.status(200).json({
            message: 'Usuario registrado exitosamente',
            user: {
                uid: user.uid,
                email,
                firstName,
                lastName,
                photoURL,
                role: role.toLowerCase(),
                status: 'active'
            },
            token,
            expirationDate
        });

    } catch (error) {
        console.log(error.message);
        res.status(500).json({ message: error.message });
    }
});

// Ruta para iniciar sesión (Login)
userRouter.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ message: 'Faltan datos requeridos' });
        }

        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const userRef = ref(database, `users/${user.uid}`);
        const userSnapshot = await get(userRef);

        if (!userSnapshot.exists()) {
            return res.status(404).json({ message: 'Datos del usuario no encontrados' });
        }

        const userData = userSnapshot.val();

        if (userData.status === 'inactive') {
            return res.status(403).json({ message: 'Usuario inactivo' });
        }

        // Generar token JWT con duración de 1 hora
        const token = jwt.sign({
            uid: user.uid,
            email: user.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            photoURL: userData.photoURL,
            role: userData.role
        }, SECRET_KEY, {
            expiresIn: '1h'
        });

        // Decodificar el token para obtener la fecha de expiración
        const decodedToken = jwt.verify(token, SECRET_KEY);
        const expirationDate = decodedToken.exp * 1000; // Convertir segundos a milisegundos

        // Enviar la información al cliente
        res.status(200).json({
            message: 'Inicio de sesión exitoso',
            user: {
                uid: user.uid,
                email: user.email,
                firstName: userData.firstName,
                lastName: userData.lastName,
                photoURL: userData.photoURL,
                role: userData.role
            },
            token,
            expirationDate
        });

    } catch (error) {
        res.status(401).json({ message: error.message });
    }
});

// Ruta para restablecer contraseña
userRouter.post('/reset-password', async (req, res) => {
    const { email } = req.body;

    try {
        if (!email) {
            return res.status(400).json({ message: 'Se requiere un correo electrónico' });
        }
        // Enviar el correo de restablecimiento de contraseña
        await sendPasswordResetEmail(auth, email);
        res.status(200).json({ message: 'Email de restablecimiento de contraseña enviado.' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Ruta para iniciar sesión con Google
userRouter.post('/google-login', async (req, res) => {
    const { idToken } = req.body;

    try {
        if (!idToken) {
            return res.status(400).json({ message: 'ID Token es requerido' });
        }

        // Verificar el ID Token con Firebase Admin
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const user = decodedToken;

        // Verificar si el usuario ya existe en Realtime Database
        const userRef = admin.database().ref(`users/${user.uid}`);
        const userSnapshot = await userRef.get();

        // Si no existe, lo guardamos en la base de datos con información básica
        if (!userSnapshot.exists()) {
            await userRef.set({
                firstName: user.name ? user.name.split(' ')[0] : '',
                lastName: user.name ? user.name.split(' ').slice(1).join(' ') : '',
                email: user.email,
                photoURL: user.picture,
                role: 'colaborador',
                status: 'active'
            });
        }

        const userData = (await userRef.get()).val();

        if (userData.status === 'inactive') {
            return res.status(403).json({ message: 'Usuario inactivo' });
        }

        // Generar token JWT con duración de 1 hora
        const token = jwt.sign({
            uid: user.uid,
            email: user.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            photoURL: userData.photoURL,
            role: userData.role
        }, SECRET_KEY, {
            expiresIn: '1h'
        });

        // Decodificar el token para obtener la fecha de expiración
        const decodedJwtToken = jwt.verify(token, SECRET_KEY);
        const expirationDate = decodedJwtToken.exp * 1000; // Convertir segundos a milisegundos

        // Responder con éxito y detalles completos del usuario autenticado, token y fecha de expiración
        res.status(200).json({
            message: 'Inicio de sesión con Google exitoso',
            user: {
                uid: user.uid,
                email: user.email,
                firstName: userData.firstName,
                lastName: userData.lastName,
                photoURL: userData.photoURL,
                role: userData.role
            },
            token,
            expirationDate
        });

    } catch (error) {
        console.log(error.message);
        res.status(401).json({ message: 'Token de ID inválido' });
    }
});


// Ruta para iniciar sesión con GitHub
userRouter.post('/github-login', async (req, res) => {
    const { accessToken } = req.body;

    try {
        // Verificar el token de acceso con Firebase Admin
        const user = await admin.auth().verifyIdToken(accessToken);

        // Verificar si el usuario ya existe en Realtime Database
        const userRef = admin.database().ref(`users/${user.uid}`);
        const userSnapshot = await userRef.get();

        // Si no existe, lo guardamos en la base de datos con información básica
        if (!userSnapshot.exists()) {
            await userRef.set({
                firstName: user.name ? user.name.split(' ')[0] : '',
                lastName: user.name ? user.name.split(' ').slice(1).join(' ') : '',
                email: user.email,
                photoURL: user.picture,
                role: 'colaborador',
                status: 'active'
            });
        }

        const userData = (await userRef.get()).val();

        if (userData.status === 'inactive') {
            return res.status(403).json({ message: 'Usuario inactivo' });
        }

        // Generar token JWT con duración de 1 hora
        const token = jwt.sign({
            uid: user.uid,
            email: user.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            photoURL: userData.photoURL,
            role: userData.role
        }, SECRET_KEY, {
            expiresIn: '1h'
        });

        // Decodificar el token para obtener la fecha de expiración
        const decodedJwtToken = jwt.verify(token, SECRET_KEY);
        const expirationDate = decodedJwtToken.exp * 1000;

        // Responder con éxito y detalles completos del usuario autenticado, token y fecha de expiración
        res.status(200).json({
            message: 'Inicio de sesión con GitHub exitoso',
            user: {
                uid: user.uid,
                email: user.email,
                firstName: userData.firstName,
                lastName: userData.lastName,
                photoURL: userData.photoURL,
                role: userData.role
            },
            token,
            expirationDate
        });

    } catch (error) {
        console.log(error.message);
        res.status(401).json({ message: 'Autenticación con GitHub fallida' });
    }
});

// Ruta para iniciar sesión con Twitter
userRouter.post('/twitter-login', async (req, res) => {
    const { accessToken } = req.body;

    try {
        // Verificar el token de acceso con Firebase Admin
        const user = await admin.auth().verifyIdToken(accessToken);

        // Verificar si el usuario ya existe en Realtime Database
        const userRef = admin.database().ref(`users/${user.uid}`);
        const userSnapshot = await userRef.get();

        // Si no existe, lo guardamos en la base de datos con información básica
        if (!userSnapshot.exists()) {
            await userRef.set({
                firstName: user.name ? user.name.split(' ')[0] : '',
                lastName: user.name ? user.name.split(' ').slice(1).join(' ') : '',
                photoURL: user.picture,
                role: 'colaborador',
                status: 'active'
            });
        }

        const userData = (await userRef.get()).val();

        if (userData.status === 'inactive') {
            return res.status(403).json({ message: 'Usuario inactivo' });
        }

        // Generar token JWT con duración de 1 hora
        const token = jwt.sign({
            uid: user.uid,
            firstName: userData.firstName,
            lastName: userData.lastName,
            photoURL: userData.photoURL,
            role: userData.role
        }, SECRET_KEY, {
            expiresIn: '1h'
        });

        // Decodificar el token para obtener la fecha de expiración
        const decodedJwtToken = jwt.verify(token, SECRET_KEY);
        const expirationDate = decodedJwtToken.exp * 1000; // Convertir segundos a milisegundos

        // Responder con éxito y detalles completos del usuario autenticado, token y fecha de expiración
        res.status(200).json({
            message: 'Inicio de sesión con Twitter exitoso',
            user: {
                uid: user.uid,
                firstName: userData.firstName,
                lastName: userData.lastName,
                photoURL: userData.photoURL,
                role: userData.role,
            },
            token,
            expirationDate
        });

    } catch (error) {
        console.log(error.message);
        res.status(401).json({ message: 'Autenticación con Twitter fallida' });
    }
});


// Ruta para verificar el token de autenticación
userRouter.post('/verify-token', async (req, res) => {
    const token = req.body.token;
    const secretKey = SECRET_KEY;

    if (!token) {
        return res.status(400).json({ message: 'Token no proporcionado' });
    }

    try {
        const decoded = jwt.verify(token, secretKey);

        // Verifica que el usuario exista en la base de datos de Firebase
        const userRef = ref(database, `users/${decoded.uid}`);
        const userSnapshot = await get(userRef);

        if (!userSnapshot.exists()) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const userData = userSnapshot.val();
        res.json({ isValid: true, userData });

    } catch (error) {
        console.error('Error al verificar el token:', error);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ isValid: false, message: 'Token expirado' });
        }
        res.status(401).json({ isValid: false, message: 'Token inválido' });
    }
});

// Ruta para obtener datos del usuario autenticado
userRouter.get('/me', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1]; // Obtén el token del encabezado

    if (!token) {
        return res.status(401).json({ message: 'Token no proporcionado' });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const userRef = ref(database, `users/${decoded.uid}`);
        const userSnapshot = await get(userRef);

        if (!userSnapshot.exists()) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const userData = userSnapshot.val();
        res.status(200).json({
            uid: decoded.uid,
            email: decoded.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            role: userData.role
        });

    } catch (error) {
        console.error(error);
        res.status(401).json({ message: 'Token inválido' });
    }
});


// Ruta para obtener todos los usuarios
userRouter.get('/users', async (req, res) => {
    try {
        // Referencia a la base de datos en la ruta "users"
        const usersRef = dbRef(database, 'users');

        // Obtener los datos de los usuarios
        const snapshot = await get(usersRef);

        if (!snapshot.exists()) {
            return res.status(404).json({ message: 'No se encontraron usuarios' });
        }

        // Convertir los datos a un formato manejable
        const users = snapshot.val();
        const usersArray = Object.keys(users).map((key) => ({
            uid: key,
            ...users[key]
        }));

        // Enviar los usuarios al cliente
        res.status(200).json(usersArray);
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Error al obtener los usuarios', error: error.message });
    }
});

// Ruta para actualizar un usuario por su UID
userRouter.put('/update-user/:uid', async (req, res) => {
    const { uid } = req.params;
    const userData = req.body;

    try {
        // Referencia al usuario específico en la base de datos
        const userRef = ref(database, `users/${uid}`);

        // Actualizar los datos del usuario
        await update(userRef, userData);

        res.status(200).json({ message: 'Usuario actualizado exitosamente' });
    } catch (error) {
        console.error('Error al actualizar el usuario:', error.message);
        res.status(500).json({ message: 'Error al actualizar el usuario', error: error.message });
    }
});


// Ruta para eliminar un usuario por su UID
userRouter.delete('/delete-user/:uid', async (req, res) => {
    const { uid } = req.params;

    try {
        // Referencia al usuario específico en la base de datos
        const userRef = ref(database, `users/${uid}`);

        // Eliminar el usuario de la base de datos Realtime Database
        await remove(userRef);

        // Eliminar el usuario de Firebase Authentication
        await admin.auth().deleteUser(uid);

        res.status(200).json({ message: 'Usuario eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar el usuario:', error.message);
        res.status(500).json({ message: 'Error al eliminar el usuario', error: error.message });
    }
});


export default userRouter;
