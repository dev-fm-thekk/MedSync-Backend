import express from 'express';

const app = express();

app.get("/", (req, res) => {
    res.send("ehlldlfjsd;lfds");
})

app.listen(8080, () => console.log("server listening on http://localhost:8080"))