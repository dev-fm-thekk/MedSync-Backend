import express from 'express';

const app = express();

app.get("/", (req, res) => {
    return res.send({
        message: "Welcome to MedVault API"
    })
})

app.listen(8080, () => console.log("server listening on http://localhost:8080"))