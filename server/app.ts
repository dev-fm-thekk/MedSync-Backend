import express from 'express';
import router from './route.js';

const app = express();

app.use(express.json())
app.use(express.urlencoded( {  extended: true }))

app.use("/api", router);

app.listen(8080, () => console.log("server listening on http://localhost:8080"))

export default app;