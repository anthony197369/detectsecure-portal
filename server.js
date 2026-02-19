import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("DetectSecure Portal is running ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
