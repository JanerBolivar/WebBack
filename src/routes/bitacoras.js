import express from 'express';
import multer from 'multer';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { database, storage } from "../firebase-config.js";
import { ref, push, set, get } from 'firebase/database';

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

// Ruta POST para actualizar una bitácora específica
logRouter.post('/update-field-logs/:id', upload, async (req, res) => {
    try {
        // Verificar si se recibieron datos
        if (!req.body.data) {
            return res.status(400).json({
                success: false,
                message: 'No se recibieron datos del formulario',
            });
        }

        const { id } = req.params;
        const formData = JSON.parse(req.body.data);
        const sitePhotosFiles = req.files['sitePhotos'] || [];
        const speciesPhotosFiles = req.files['speciesPhotos[]'] || [];

        // Obtener la bitácora existente
        const fieldLogRef = ref(database, `fieldLogs/${id}`);
        const snapshot = await get(fieldLogRef);

        if (!snapshot.exists()) {
            return res.status(403).json({
                success: false,
                message: 'Bitácora no encontrada',
            });
        }

        const existingLog = snapshot.val();

        // Validar si hay nuevos archivos antes de procesarlos
        const hasNewSitePhotos = sitePhotosFiles.length > 0;
        const hasNewSpeciesPhotos = speciesPhotosFiles.length > 0;

        console.log('Total de fotos de especies recibidas:', speciesPhotosFiles.length);

        // Procesar nuevas fotos del sitio solo si hay cambios
        let updatedSitePhotos = existingLog.sitePhotos || [];
        if (hasNewSitePhotos) {
            const newSitePhotosUrls = await Promise.all(
                sitePhotosFiles.map((file) =>
                    uploadImageToFirebase(file, 'site-photos')
                )
            );
            updatedSitePhotos = [...updatedSitePhotos, ...newSitePhotosUrls];
        }

        // Identificar especies nuevas y existentes
        const existingSpeciesNames = new Set(
            existingLog.collectedSpecies?.map(species => species.scientificName) || []
        );

        // Encontrar la primera especie nueva que tenga fotos
        const newSpeciesIndex = formData.collectedSpecies.findIndex(
            species => !existingSpeciesNames.has(species.scientificName)
        );

        // Procesar especies y nuevas fotos
        const processedSpecies = await Promise.all(
            formData.collectedSpecies.map(async (species, index) => {
                // Buscar la especie existente en los datos originales
                const existingSpecies = existingLog.collectedSpecies?.find(
                    (existing) => existing.scientificName === species.scientificName
                );

                // Determinar si es una especie nueva
                const isNewSpecies = !existingSpecies;

                // Inicializar fotos existentes
                let photoUrls = isNewSpecies ? [] : (existingSpecies.photos || []);

                // Si es una especie nueva y hay fotos nuevas, asignar todas las fotos a esta especie
                if (isNewSpecies && hasNewSpeciesPhotos && index === newSpeciesIndex) {
                    console.log(`Asignando ${speciesPhotosFiles.length} fotos a la nueva especie ${species.scientificName}`);

                    const newPhotoUrls = await Promise.all(
                        speciesPhotosFiles.map((file) =>
                            uploadImageToFirebase(
                                file,
                                `species-photos/${species.scientificName.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown'}`
                            )
                        )
                    );
                    console.log(`URLs nuevas para ${species.scientificName}:`, newPhotoUrls);
                    photoUrls = [...photoUrls, ...newPhotoUrls];
                }

                console.log(`Procesando especie ${species.scientificName}:`, {
                    isNew: isNewSpecies,
                    existingPhotos: photoUrls.length,
                    newPhotos: isNewSpecies && index === newSpeciesIndex ? speciesPhotosFiles.length : 0,
                    isNewSpeciesWithPhotos: isNewSpecies && index === newSpeciesIndex
                });

                // Retornar especie actualizada
                return {
                    ...species,
                    photos: photoUrls,
                };
            })
        );

        // Crear el objeto actualizado de la bitácora
        const updatedFieldLogData = {
            ...existingLog,
            ...formData,
            sitePhotos: hasNewSitePhotos ? updatedSitePhotos : existingLog.sitePhotos,
            collectedSpecies: processedSpecies,
            updatedAt: new Date().toISOString(),
        };

        // Actualizar la bitácora en Firebase Realtime Database
        await set(fieldLogRef, updatedFieldLogData);

        res.status(200).json({
            success: true,
            message: 'Bitácora actualizada exitosamente',
            data: {
                id: id,
                ...updatedFieldLogData,
            },
        });
    } catch (error) {
        console.error('Error detallado:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la bitácora',
            error: error.message,
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


// Ruta GET para obtener una bitácora específica por su id
logRouter.get('/field-logs/:id', async (req, res) => {
    try {
        const { id } = req.params;  // Obtener el id de la bitácora desde la URL
        const fieldLogsRef = admin.database().ref('fieldLogs');

        // Obtener los datos de la bitácora específica
        const snapshot = await fieldLogsRef.child(id).once('value');
        const log = snapshot.val();

        // Verificar si la bitácora existe
        if (!log) {
            return res.status(404).json({ error: 'Bitácora no encontrada' });
        }

        if (log.status === false) {
            return res.status(403).json({ error: 'La bitácora está desactivada' });
        }

        // Si la bitácora existe, devolverla
        res.status(200).json({
            id,
            ...log
        });

    } catch (error) {
        console.error('Error al obtener la bitácora:', error);
        res.status(500).json({
            error: 'Error al obtener la bitácora',
            details: error.message
        });
    }
});

// Ruta DELETE para eliminar una bitácora específica
logRouter.delete('/delete-log/:id', async (req, res) => {
    try {
        const { id } = req.params;  // Obtener el id de la bitácora desde la URL
        const fieldLogsRef = admin.database().ref('fieldLogs');

        // Obtener los datos de la bitácora específica
        const snapshot = await fieldLogsRef.child(id).once('value');
        const log = snapshot.val();

        // Verificar si la bitácora existe
        if (!log) {
            return res.status(404).json({ error: 'Bitácora no encontrada' });
        }

        // Cambiar el estado de la bitácora a 'false'
        await fieldLogsRef.child(id).update({ status: false });

        // Devolver una respuesta indicando que la actualización fue exitosa
        res.status(200).json({
            message: 'El estado de la bitácora ha sido actualizado',
            id,
            status: false,
        });

    } catch (error) {
        console.error('Error al actualizar el estado de la bitácora:', error);
        res.status(500).json({
            error: 'Error al actualizar el estado de la bitácora',
            details: error.message
        });
    }
});


logRouter.get('/collaborators/search', async (req, res) => {
    try {
        const { term } = req.query;

        if (!term || term.length < 2) {
            return res.status(400).json({ message: 'El término de búsqueda debe tener al menos 2 caracteres.' });
        }

        // Referencia a la colección 'users' en Firebase
        const usersRef = admin.database().ref('users');

        // Obtener todos los usuarios
        const snapshot = await usersRef.once('value');
        const users = snapshot.val();

        if (!users) {
            return res.status(404).json({ message: 'No se encontraron usuarios.' });
        }

        // Filtrar usuarios por nombre (firstName + lastName) o correo electrónico
        const filteredUsers = Object.entries(users)  // Usamos Object.entries() para mantener el uid
            .filter(([uid, user]) =>
                user &&
                (
                    (user.firstName && user.firstName.toLowerCase().includes(term.toLowerCase())) ||
                    (user.lastName && user.lastName.toLowerCase().includes(term.toLowerCase())) ||
                    (user.email && user.email.toLowerCase().includes(term.toLowerCase()))
                )
            )
            .map(([uid, user]) => {
                return { uid, ...user };
            });

        console.log('Resultados de la búsqueda:', filteredUsers);

        // Retornar los resultados encontrados
        return res.json(filteredUsers);

    } catch (error) {
        console.error('Error al buscar usuarios:', error);
        return res.status(500).json({ message: 'Hubo un error al buscar los usuarios.' });
    }
});


logRouter.get('/comments/:id', async (req, res) => {
    try {
        const { id } = req.params; // ID de la bitácora
        const commentsRef = admin.database().ref(`fieldLogs/${id}/comments`);

        // Obtener los comentarios de la bitácora
        const snapshot = await commentsRef.once('value');
        const comments = snapshot.val();

        if (!comments) {
            return res.status(403).json({ error: 'No se encontraron comentarios para esta bitácora' });
        }

        // Convertir los comentarios a un arreglo
        const commentsArray = Object.entries(comments).map(([key, value]) => ({
            id: key,
            ...value
        }));

        res.status(200).json(commentsArray);
    } catch (error) {
        console.error('Error al obtener los comentarios:', error);
        res.status(500).json({
            error: 'Error al obtener los comentarios',
            details: error.message
        });
    }
});


logRouter.post('/comments/:id', async (req, res) => {
    try {
        const { id } = req.params; // ID de la bitácora
        const { comment, user } = req.body; // Comentario y datos del usuario

        if (!comment || !user) {
            return res.status(400).json({ error: 'El comentario y el usuario son obligatorios' });
        }

        const commentsRef = admin.database().ref(`fieldLogs/${id}/comments`);
        const newCommentRef = commentsRef.push();

        // Datos del nuevo comentario
        const newComment = {
            comment,
            user,
            timestamp: Date.now()
        };

        // Guardar el comentario en la base de datos
        await newCommentRef.set(newComment);

        res.status(201).json({
            id: newCommentRef.key,
            ...newComment
        });
    } catch (error) {
        console.error('Error al agregar el comentario:', error);
        res.status(500).json({
            error: 'Error al agregar el comentario',
            details: error.message
        });
    }
});





export default logRouter;
