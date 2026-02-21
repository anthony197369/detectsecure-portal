import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
process.on("uncaughtException", err => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", err => {
  console.error("UNHANDLED PROMISE:", err);
});
const app = express();

// ---- CORS ----
app.use(
  cors({
    origin: [
      "https://detectsecureid.com",
      "https://www.detectsecureid.com",
      // optional: allow Hostinger preview domain if you test from there
      "https://snow-wallaby-925207.hostingersite.com",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// ---- Supabase env ----
const SUPABASE_URL = process.env.SUPABASE_URL || "https://hzxivuwuqgmeiesvvrny.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Public client (safe reads)
let supabasePublic = null;
// Admin client (bypasses RLS for inserts)
let supabaseAdmin = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
}

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

// ---- Health ----
app.get("/", (req, res) => {
  res.send("DetectSecure API running ✅");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasAnonKey: !!SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
  });
});

// ---- Test DB connection (READ using public client) ----
app.get("/api/test", async (req, res) => {
  if (!supabasePublic) {
    return res.status(500).json({
      success: false,
      error: "Supabase public client not configured (SUPABASE_URL / SUPABASE_ANON_KEY).",
    });
  }

  const { data, error } = await supabasePublic.from("detectors").select("id").limit(1);
  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, data });
});

// ---- Verify endpoint (READ using public client) ----
app.get("/api/verify", async (req, res) => {
  const id = (req.query.id || "").toString().trim().toUpperCase();
  if (!id) return res.status(400).json({ success: false, error: "Missing id" });

  if (!supabasePublic) {
    return res.status(500).json({
      success: false,
      error: "Supabase public client missing on server.",
    });
  }

  const { data, error } = await supabasePublic
    .from("detectors")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, registered: !!data, id });
});

// ---- Simple Verify page ----
app.get("/verify", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`
    <!doctype html>
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

            const r = await fetch(window.location.origin + "/api/verify?id=" + encodeURIComponent(id));
            const j = await r.json();

            document.getElementById("out").innerHTML =
              j.registered ? "✅ Registered" : "❌ Not Found";
          }
        </script>
      </body>
    </html>
  `);
});

// ---- Report Found page ----
app.get("/report", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Report Found</title></head>
<body style="font-family:Arial;padding:30px;">
  <h2>Report Found Item</h2>

  <p><label>ID:</label><br><input id="id" style="padding:10px;width:260px" placeholder="DS-10482"></p>
  <p><label>Your name:</label><br><input id="finder_name" style="padding:10px;width:260px" placeholder="Your name"></p>
  <p><label>Your email (required):</label><br><input id="finder_email" style="padding:10px;width:260px" placeholder="you@email.com"></p>
  <p><label>Message:</label><br><textarea id="message" style="padding:10px;width:360px;height:110px" placeholder="Where you found it, best time to contact, etc"></textarea></p>

  <button onclick="send()" style="padding:12px 18px;">Send to Owner</button>
  <div id="out" style="margin-top:18px;font-size:18px;"></div>

<script>
async function send(){
  const id = document.getElementById("id").value.trim();
  const finder_name = document.getElementById("finder_name").value.trim();
  const finder_email = document.getElementById("finder_email").value.trim();
  const message = document.getElementById("message").value.trim();

  if(!id || !finder_email){
    document.getElementById("out").innerText="❌ ID + Email required";
    return;
  }

  const r = await fetch(window.location.origin + "/api/report", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ id, finder_name, finder_email, message })
  });

  const j = await r.json();
  document.getElementById("out").innerText =
    j.success ? "✅ Sent successfully" : ("❌ " + (j.error || "Failed"));
}
</script>
</body>
</html>`);
});

// ---- Report Found API (WRITE using admin client) ----
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
        error: "Supabase admin client missing (SUPABASE_SERVICE_ROLE_KEY).",
      });
    }

    // 1) Look up the owner (using admin avoids any RLS issues)
    const { data: owner, error: ownerErr } = await supabaseAdmin
      .from("detectors")
      .select("email")
      .eq("id", cleanId)
      .maybeSingle();

    if (ownerErr) {
      return res.status(500).json({ success: false, error: ownerErr.message });
    }

    const owner_email = owner?.email || null;

    // 2) Insert the report row
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

    if (insErr) {
      return res.status(500).json({ success: false, error: insErr.message });
    }

    return res.json({ success: true, inserted });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Optional: browser-friendly message (GET)
app.get("/api/report", (req, res) => {
  res.status(405).send("Use POST /api/report");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));

