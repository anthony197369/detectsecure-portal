import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Don’t crash the server if env vars are missing
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
}

// Basic health check
app.get("/", (req, res) => {
  res.send("DetectSecure API running ✅");
});

// Check env var status quickly in browser
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasAnonKey: !!SUPABASE_ANON_KEY,
  });
});

// Test DB connection (won’t crash if table missing)
app.get("/api/test", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({
      success: false,
      error: "Supabase env vars missing on server (SUPABASE_URL / SUPABASE_ANON_KEY).",
    });
  }

  const { data, error } = await supabase
    .from("detectors")
    .select("id")
    .limit(1);

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

// ✅ THIS is the automatic “Verify ID” endpoint
// Example: /api/verify?id=DS-10482
app.get("/api/verify", async (req, res) => {
  const id = (req.query.id || "").toString().trim();

  if (!id) return res.status(400).json({ success: false, error: "Missing id" });
  if (!supabase) {
    return res.status(500).json({
      success: false,
      error: "Supabase env vars missing on server.",
    });
  }

  const { data, error } = await supabase
    .from("detectors")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({
    success: true,
    registered: !!data,
    id,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));



