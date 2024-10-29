
import e, { Router } from "express"
import userRouter from "./usuarios.js"

const router = Router()

// Rutas de usuarios
router.use("/user", userRouter)


export default router