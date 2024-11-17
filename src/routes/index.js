
import e, { Router } from "express"
import userRouter from "./usuarios.js"
import logRouter from "./bitacoras.js"
import prueba from './uploadRoute.js';

const router = Router()

// Rutas de usuarios
router.use("/user", userRouter)
router.use("/log", logRouter)
router.use("/prueba", prueba)


export default router