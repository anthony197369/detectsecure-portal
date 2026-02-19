import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// Connect to Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Test route
app.get("/", (req, res) => {
  res.send("DetectSecure API running");
});

// Test database connection
app.get("/api/test", async (req, res) => {
  const { data, error } = await supabase
    .from("detectors")
    .select("*")
    .limit(1);

  if (error) {
    return res.json({ success: false, error: error.message });
  }

  res.json({ success: true, data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});



