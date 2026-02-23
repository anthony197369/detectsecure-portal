import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();

// ---- CORS ----
app.use(
  cors({
    origin: ["https://detectsecureid.com", "https://www.detectsecureid.com"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// ---- Supabase env vars ----
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

// Public client (reads)
const supabasePublic =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Admin client (writes)
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

// ---- Root ----
app.get("/", (req, res) => res.send("DetectSecure API running ✅"));

// ---- Health ----
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasAnonKey: !!SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
  });
});

// ---- Verify endpoint ----
app.get("/api/verify", async (req, res) => {
  try {
    const id = (req.query.id || "").toString().trim().toUpperCase();
    if (!id) return res.status(400).json({ success: false, error: "Missing id" });

    if (!supabasePublic) {
      return res.status(500).json({
        success: false,
        error: "Supabase env vars missing (SUPABASE_URL / SUPABASE_ANON_KEY).",
      });
    }

    const { data, error } = await supabasePublic
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

// ---- Simple verify page ----
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

// ---- Report page ----
app.get("/report", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Report Found Item</title>
</head>
<body style="font-family:Arial;padding:30px;">
  <h2>Report Found Item</h2>

  <p><label>ID:</label><br>
    <input id="id" style="padding:10px;width:260px" placeholder="DS-10482">
  </p>

  <p><label>Your name:</label><br>
    <input id="finder_name" style="padding:10px;width:260px" placeholder="Your name">
  </p>

  <p><label>Your email (required):</label><br>
    <input id="finder_email" style="padding:10px;width:260px" placeholder="you@email.com">
  </p>

  <p><label>Message:</label><br>
    <textarea id="message" style="padding:10px;width:360px;height:110px"
      placeholder="Where you found it, best time to contact, etc"></textarea>
  </p>

  <button onclick="sendReport()" style="padding:12px 18px;">Send to Owner</button>
  <div id="out" style="margin-top:18px;font-size:18px;"></div>

  <script>
    // Autofill ID from URL: /report?id=DS-10482
    (function(){
      const params = new URLSearchParams(window.location.search);
      const id = (params.get("id") || "").trim().toUpperCase();
      if(id) document.getElementById("id").value = id;
    })();

    async function sendReport(){
      const id = document.getElementById("id").value.trim().toUpperCase();
      const finder_name = document.getElementById("finder_name").value.trim();
      const finder_email = document.getElementById("finder_email").value.trim();
      const message = document.getElementById("message").value.trim();

      if(!id || !finder_email){
        document.getElementById("out").innerText = "❌ ID + Email required";
        return;
      }

      document.getElementById("out").innerText = "⏳ Sending...";

      const r = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ id, finder_name, finder_email, message })
      });

      let j = null;
      try { j = await r.json(); } catch(e) {}

      if(r.ok && j && j.success){
        document.getElementById("out").innerText = "✅ Saved to database";
      } else {
        const msg = (j && (j.error || j.message)) ? (j.error || j.message) : ("HTTP " + r.status);
        document.getElementById("out").innerText = "❌ " + msg;
      }
    }
  </script>
</body>
</html>`);
});

// ---- Report API (POST) ----
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

    if (!supabasePublic) {
      return res.status(500).json({
        success: false,
        error: "Supabase public client missing (SUPABASE_URL / SUPABASE_ANON_KEY).",
      });
    }
    if (!supabaseAdmin) {
      return res.status(500).json({
        success: false,
        error:
          "Supabase admin client missing (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY).",
      });
    }

    // Look up owner email from detectors table
    const { data: owner, error: ownerErr } = await supabasePublic
      .from("detectors")
      .select("email")
      .eq("id", cleanId)
      .maybeSingle();

    if (ownerErr) return res.status(500).json({ success: false, error: ownerErr.message });

    const owner_email = owner?.email || null;

    // Insert into found_reports
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

// Optional GET message
app.get("/api/report", (req, res) => {
  res.status(405).send("Use POST /api/report (this endpoint expects a form submit / fetch POST).");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));


