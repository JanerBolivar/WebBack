import express from "express"
import cors from "cors"
import morgan from "morgan"
import router from "./routes/index.js"


//Puerto del servidor
const port = process.env.PORT || 3000
const app = express()

app.use(cors())
app.use(express.json())
app.use(morgan("dev"))

//Configuracion del puerto del servidor
app.set("port", port);

//routes
app.use("/api", router);

//start server
app.listen(app.get("port"), () => {
    console.log("😁 server en puerto", app.get("port",));
});