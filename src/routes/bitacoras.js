import express from 'express';
import multer from 'multer';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { database, storage } from "../firebase-config.js";
import { ref, push, set } from 'firebase/database';

import { DATABASE_URL } from "../config/index.js";

import credentialsAPI from "../config/env.js";
import admin from 'firebase-admin';


// Verificar si ya se ha inicializado la aplicación de Firebase
if (admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.cert(credentialsAPI),
        databaseURL: DATABASE_URL
    });
} else {
    console.log('Firebase app already initialized');
}



const logRouter = express.Router();


// Configuración de multer para manejar múltiples campos
const memoryStorage = multer.memoryStorage();
const upload = multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB por archivo
}).fields([
    { name: 'sitePhotos', maxCount: 10 },
    { name: 'speciesPhotos[]', maxCount: 50 }
]);

// Función para subir la imagen a Firebase Storage
const uploadImageToFirebase = async (file, path) => {
    if (!file) return null;

    try {
        const filename = `${path}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const imageRef = storageRef(storage, filename);

        // Subir el archivo a Firebase Storage
        await uploadBytes(imageRef, file.buffer);

        // Obtener la URL pública de la imagen subida
        const photoURL = await getDownloadURL(imageRef);
        return photoURL;
    } catch (error) {
        console.error(`Error al subir imagen ${file.originalname}:`, error);
        throw new Error(`Error al subir imagen: ${error.message}`);
    }
};

// Ruta para crear una nueva bitácora
logRouter.post('/new-field-logs', upload, async (req, res) => {
    try {
        if (!req.body.data) {
            return res.status(400).json({
                success: false,
                message: 'No se recibieron datos del formulario'
            });
        }

        const formData = JSON.parse(req.body.data);
        const sitePhotosFiles = req.files['sitePhotos'] || [];
        const speciesPhotosFiles = req.files['speciesPhotos[]'] || [];

        // Subir fotos del sitio a Firebase Storage
        const sitePhotosUrls = await Promise.all(
            sitePhotosFiles.map((file) => uploadImageToFirebase(file, 'site-photos'))
        );

        // Procesar especies y subir fotos
        const processedSpecies = await Promise.all(
            formData.collectedSpecies.map(async (species) => {
                const speciesPhotos = speciesPhotosFiles.filter((file) =>
                    file.fieldname === 'speciesPhotos[]'
                );

                const photoUrls = await Promise.all(
                    speciesPhotos.map((file) =>
                        uploadImageToFirebase(
                            file,
                            `species-photos/${species.scientificName.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown'}`
                        )
                    )
                );

                return {
                    ...species,
                    photos: photoUrls
                };
            })
        );

        // Crear el objeto de la bitácora
        const fieldLogData = {
            ...formData,
            sitePhotos: sitePhotosUrls,
            collectedSpecies: processedSpecies,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: true
        };

        // Guardar la bitácora en Firebase Realtime Database
        const fieldLogsRef = ref(database, 'fieldLogs');
        const newFieldLogRef = push(fieldLogsRef);
        await set(newFieldLogRef, fieldLogData);

        res.status(201).json({
            success: true,
            message: 'Bitácora creada exitosamente',
            data: {
                id: newFieldLogRef.key,
                ...fieldLogData
            }
        });
    } catch (error) {
        console.error('Error detallado:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear la bitácora',
            error: error.message
        });
    }
});



// Ruta GET para obtener todas las bitácoras activas
logRouter.get('/field-logs', async (req, res) => {
    try {
        // Referencia a la colección de fieldLogs
        const fieldLogsRef = admin.database().ref('fieldLogs');

        // Obtener los datos
        const snapshot = await fieldLogsRef.once('value');
        const fieldLogs = snapshot.val();

        // Si no hay datos, devolver array vacío
        if (!fieldLogs) {
            return res.status(200).json([]);
        }

        // Filtrar solo las bitácoras con status true y transformar a array
        const activeFieldLogs = Object.entries(fieldLogs)
            .filter(([_, log]) => log.status === true)
            .map(([id, log]) => ({
                id,
                ...log
            }));

        // Ordenar por fecha de creación (más reciente primero)
        activeFieldLogs.sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        res.status(200).json(activeFieldLogs);

    } catch (error) {
        console.error('Error al obtener las bitácoras:', error);
        res.status(500).json({
            error: 'Error al obtener las bitácoras',
            details: error.message
        });
    }
});



export default logRouter;
