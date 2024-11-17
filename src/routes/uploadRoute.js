import express from 'express';
import multer from 'multer';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from "../firebase-config.js";

const prueba = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

// Ruta para probar la carga de múltiples imágenes
prueba.post('/upload-images', upload.array('images', 10), async (req, res) => {  // max 10 imágenes
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'No se ha recibido ninguna imagen.',
        });
    }

    try {
        const photoURLs = [];  // Array para almacenar las URLs de las imágenes subidas

        // Subir cada imagen
        for (const file of req.files) {
            // Generar un nombre único para cada imagen utilizando un timestamp y el nombre original
            const filename = `images/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
            const imageRef = storageRef(storage, filename);

            // Subir la imagen a Firebase Storage
            await uploadBytes(imageRef, file.buffer);

            // Obtener la URL pública de la imagen subida
            const photoURL = await getDownloadURL(imageRef);
            photoURLs.push(photoURL);  // Añadir la URL al array
        }

        return res.status(200).json({
            success: true,
            message: 'Imágenes subidas con éxito',
            photoURLs,  // Devuelve todas las URLs de las imágenes
        });
    } catch (error) {
        console.error('Error al subir las imágenes:', error);
        return res.status(500).json({
            success: false,
            message: 'Error al subir las imágenes',
            error: error.message,
        });
    }
});

export default prueba;
