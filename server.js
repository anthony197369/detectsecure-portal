import dotenv from "dotenv";

// load environment variables provided by Hostinger
const result = dotenv.config();

console.log("DOTENV RESULT:", result.error ? result.error : "loaded");
console.log("ENV SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("ENV SERVICE KEY EXISTS:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();

// --- CORS ---
app.use(
  cors({
    origin: ["https://detectsecureid.com", "https://www.detectsecureid.com", "*"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// --- Supabase env vars ---
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Use ADMIN client for server routes (most reliable)
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

// --- Basic health check ---
app.get("/", (req, res) => res.send("DetectSecure API running ✅ v1-ENVTEST"));
app.get("/envtest", (req, res) => {
  res.json({ ok: true, keys: Object.keys(process.env).slice(0, 20) });
});
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasAnonKey: !!process.env.SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
});

// --- Verify ID ---
// /api/verify?id=DS-10482
app.get("/api/verify", async (req, res) => {
  try {
    const id = String(req.query.id || "")
      .trim()
      .toUpperCase();

    if (!id) return res.status(400).json({ success: false, error: "Missing id" });
    if (!supabaseAdmin)
      return res.status(500).json({ success: false, error: "Supabase admin client missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });

    const { data, error } = await supabaseAdmin
      .from("detectors")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({ success: true, registered: !!data, id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Simple Verify page
app.get("/verify", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DetectSecure ID Check</title>
  <style>
    body{font-family:Arial;padding:40px;text-align:center}
    input{padding:12px;font-size:18px;width:220px}
    button{padding:12px 20px;font-size:18px;margin-left:10px}
    #out{margin-top:20px;font-size:20px}
  </style>
</head>
<body>
  <h2>Check DetectSecure ID</h2>
  <input id="id" placeholder="DS-10482"/>
  <button onclick="go()">Check</button>
  <div id="out"></div>

  <script>
    async function go(){
      const id=document.getElementById("id").value.trim();
      if(!id) return;
      const r = await fetch("/api/verify?id=" + encodeURIComponent(id));
      const j = await r.json();
      document.getElementById("out").innerHTML =
        j.registered ? "✅ Registered" : "❌ Not Found";
    }
  </script>
</body>
</html>`);
});

// --- Report Found (POST) ---
// Expects: { id, finder_name, finder_email, message }
app.post("/api/report", async (req, res) => {
  try {
    const { id, finder_name, finder_email, message } = req.body || {};

    const cleanId = String(id || "").trim().toUpperCase();
    const cleanEmail = String(finder_email || "").trim();

    if (!cleanId || !cleanEmail) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields (id, finder_email)",
      });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({
        success: false,
        error: "Supabase admin client missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
      });
    }

    // 1) Look up owner email from detectors table
    const { data: owner, error: ownerErr } = await supabaseAdmin
      .from("detectors")
      .select("email")
      .eq("id", cleanId)
      .maybeSingle();

    if (ownerErr) return res.status(500).json({ success: false, error: ownerErr.message });

    const owner_email = owner?.email || null;

    // 2) Insert into found_reports
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("found_reports")
      .insert([
        {
          detector_id: cleanId,
          finder_name: finder_name ? String(finder_name).trim() : null,
          finder_email: cleanEmail,
          message: message ? String(message).trim() : null,
          owner_email,
        },
      ])
      .select("*")
      .single();

    if (insErr) return res.status(500).json({ success: false, error: insErr.message });

    return res.json({ success: true, inserted });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Browser-friendly message if someone opens /api/report
app.get("/api/report", (req, res) => {
  res.status(405).send("Use POST /api/report (this endpoint expects a fetch POST).");
});

// --- Report page (GET) ---
// Auto-fills from: /report?id=DS-10482
app.get("/report", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Report Found</title>
  <style>
    body{font-family:Arial;padding:22px;max-width:520px;margin:0 auto}
    input,textarea{width:100%;padding:12px;font-size:16px;margin-top:6px}
    button{padding:12px 16px;font-size:16px;margin-top:12px}
    #out{margin-top:14px;font-size:16px}
  </style>
</head>
<body>
  <h2>Report Found Item</h2>

  <p><label>ID:</label><br><input id="id" placeholder="DS-10482"></p>
  <p><label>Your name:</label><br><input id="name" placeholder="Your name"></p>
  <p><label>Your email (required):</label><br><input id="email" placeholder="you@email.com"></p>
  <p><label>Message:</label><br><textarea id="msg" placeholder="Where you found it, best time to contact, etc"></textarea></p>

  <button id="btn" onclick="send()">Send to Owner</button>
  <div id="out"></div>

  <script>
    // Autofill ID from URL ?id=
    (function () {
      const params = new URLSearchParams(window.location.search);
      const id = (params.get("id") || "").trim().toUpperCase();
      if (id) document.getElementById("id").value = id;
    })();

    async function send(){
      const id = document.getElementById("id").value.trim();
      const finder_name = document.getElementById("name").value.trim();
      const finder_email = document.getElementById("email").value.trim();
      const message = document.getElementById("msg").value.trim();

      const out = document.getElementById("out");
      out.innerText = "";

      if(!id || !finder_email){
        out.innerText = "❌ ID + Email required";
        return;
      }

      document.getElementById("btn").disabled = true;
      out.innerText = "Sending...";

      try {
        const r = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ id, finder_name, finder_email, message })
        });

        const text = await r.text();
        let j = null;
        try { j = JSON.parse(text); } catch(e) {}

        if(!j){
          out.innerText = "❌ Server returned non-JSON response (likely an error page).";
          return;
        }

        out.innerText = j.success ? "✅ Saved to database" : ("❌ " + (j.error || "Failed"));
      } catch(e){
        out.innerText = "❌ " + e.message;
      } finally {
        document.getElementById("btn").disabled = false;
      }
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
