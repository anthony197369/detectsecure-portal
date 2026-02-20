import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors({
  origin: [
    "https://detectsecureid.com",
    "https://www.detectsecureid.com"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

// ✅ Don’t crash the server if env vars are missing
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://hzxivuuwqgmeiesvvrny.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_PES5RNt9Zt9r6af-r7j47g_dMds_iAd";

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
  const id = (req.query.id || "").toString().trim().toUpperCase();

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

           const j=await r.json();
            document.getElementById("out").innerHTML =
              j.registered ? "✅ Registered" : "❌ Not Found";
          }
        </script>
      </body>
    </html>
  `);
});
// ===============================
// REPORT FOUND ITEM (EMAIL OWNER)
// ===============================
app.post("/api/report-found", async (req, res) => {
  try {
    const { id, finder_name, finder_email, message } = req.body;

    if (!id || !finder_email) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // Find owner in database
    const { data: owner, error } = await supabase
      .from("detectors")
      .select("name,email")
      .eq("id", id)
      .maybeSingle();

    if (error || !owner) {
      return res.json({ success: false, error: "ID not registered" });
    }

    // Email content
    const emailText = `
Good news — your DetectSecure item has been found!

ID: ${id}

Finder details:
Name: ${finder_name || "Not provided"}
Email: ${finder_email}

Message:
${message || "No message left"}

Reply directly to this email to contact the finder.
`;

    // TEMP: log instead of send (we wire real email next step)
    console.log("SEND EMAIL TO:", owner.email);
    console.log(emailText);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});
// ===============================
// REPORT FOUND ITEM (EMAIL OWNER - STEP 1: LOG ONLY)
// ===============================
app.post("/api/report-found", async (req, res) => {
  try {
    const { id, finder_name, finder_email, message } = req.body || {};

    if (!id || !finder_email) {
      return res.status(400).json({ success: false, error: "Missing id or finder_email" });
    }

    const cleanId = String(id).trim();

    const { data: owner, error } = await supabase
      .from("detectors")
      .select("name,email")
      .eq("id", cleanId)
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!owner) return res.json({ success: false, error: "ID not registered" });

    const emailText = `Good news — your DetectSecure item has been found!

ID: ${cleanId}

Finder details:
Name: ${finder_name || "Not provided"}
Email: ${finder_email}

Message:
${message || "No message left"}

Reply to the finder to arrange return.`;

    // For now: just log (we’ll wire real email next)
    console.log("=== REPORT FOUND ===");
    console.log("SEND TO OWNER:", owner.email);
    console.log(emailText);

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// Simple “Report Found” page (so you can test without Hostinger Builder limits)
app.get("/report", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Report Found</title></head>
<body style="font-family:Arial;padding:30px;">
  <h2>Report Found Item</h2>

  <p><label>ID:</label><br><input id="id" style="padding:10px;width:260px" placeholder="DS-10482"></p>
  <p><label>Your name:</label><br><input id="name" style="padding:10px;width:260px" placeholder="Your name"></p>
  <p><label>Your email (required):</label><br><input id="email" style="padding:10px;width:260px" placeholder="you@email.com"></p>
  <p><label>Message:</label><br><textarea id="msg" style="padding:10px;width:360px;height:110px" placeholder="Where you found it, best time to contact, etc"></textarea></p>

  <button onclick="send()" style="padding:12px 18px;">Send to Owner</button>
  <div id="out" style="margin-top:18px;font-size:18px;"></div>

<script>
async function send(){
  const id = document.getElementById("id").value.trim();
  const finder_name = document.getElementById("name").value.trim();
  const finder_email = document.getElementById("email").value.trim();
  const message = document.getElementById("msg").value.trim();
  if(!id || !finder_email){ document.getElementById("out").innerText="❌ ID + Email required"; return; }

  const r = await fetch("/api/report-found", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ id, finder_name, finder_email, message })
  });

  const j = await r.json();
  document.getElementById("out").innerText = j.success ? "✅ Sent (logged on server for now)" : ("❌ " + (j.error || "Failed"));
}
</script>
</body>
</html>`);
});
// ----------------------------
// Report Found Item (POST)
// ----------------------------
app.post("/api/report", async (req, res) => {
  try {
    const { id, name, email, message } = req.body || {};

    if (!id || !email) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields (id, email)",
      });
    }

    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: "Supabase env vars missing on server.",
      });
    }

    // 1) Look up the owner by detector id
    const { data: owner, error: ownerErr } = await supabase
      .from("detectors")
      .select("email")
      .eq("id", id)
      .maybeSingle();

    if (ownerErr) {
      return res.status(500).json({ success: false, error: ownerErr.message });
    }

    const owner_email = owner?.email || null;

    // 2) Insert the report row and RETURN it
    const { data: inserted, error: insErr } = await supabase
      .from("found_reports")
      .insert([
        {
          detector_id: id,
          finder_name: name || null,
          finder_email: email,
          message: message || null,
          owner_email,
        },
      ])
      .select("*")
      .single();

    if (insErr) {
      return res.status(500).json({ success: false, error: insErr.message });
    }

    // ✅ This proves it actually wrote to DB
    return res.json({ success: true, inserted });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Optional: browser-friendly message (GET)
app.get("/api/report", (req, res) => {
  res.status(405).send("Use POST /api/report (this endpoint expects a form submit / fetch POST).");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));



