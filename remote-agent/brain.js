// Brain CLI - 道的手指
// Usage: node brain.js exec "command"
//        node brain.js state
//        node brain.js say "message"
//        node brain.js terminal

const http = require("http");
const BASE =
  process.env.BRAIN_URL || "http://localhost:" + (process.env.PORT || "3002");
const TOKEN = process.env.PS_AGENT_MASTER_TOKEN || "";

function authHeaders() {
  var h = { "Content-Type": "application/json" };
  if (TOKEN) h["Authorization"] = "Bearer " + TOKEN;
  return h;
}

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(
      BASE + path,
      {
        method: "POST",
        headers: authHeaders(),
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            resolve(d);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    var url = BASE + path + (TOKEN ? sep + "token=" + TOKEN : "");
    http
      .get(url, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            resolve(d);
          }
        });
      })
      .on("error", reject);
  });
}

async function main() {
  const cmd = process.argv[2];
  const arg = process.argv.slice(3).join(" ");

  if (cmd === "exec" || cmd === "x") {
    const t0 = Date.now();
    const r = await post("/brain/exec", { cmd: arg, timeout: 60000 });
    const dt = Date.now() - t0;
    if (r.ok) {
      console.log(r.output);
      console.log(
        "\n--- OK " + (r.ms || "?") + "ms (roundtrip " + dt + "ms) ---",
      );
    } else {
      console.error("FAIL:", r.error || r.output);
    }
  } else if (cmd === "state" || cmd === "s") {
    const r = await get("/brain/state");
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === "say") {
    const r = await post("/brain/say", { text: arg, level: "system" });
    console.log(r);
  } else if (cmd === "terminal" || cmd === "t") {
    const r = await get("/brain/terminal?n=" + (arg || 10));
    r.forEach((e) => {
      console.log("> " + e.cmd);
      console.log(e.output);
      console.log("---");
    });
  } else if (cmd === "sysinfo" || cmd === "si") {
    const r = await post("/brain/sysinfo", {});
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === "auto" || cmd === "a") {
    console.log("Running auto-diagnostics...\n");
    const t0 = Date.now();
    const r = await post("/brain/auto", {});
    const dt = Date.now() - t0;
    if (r.ok && r.results) {
      var maxName = 0;
      r.results.forEach(function (x) {
        if (x.name.length > maxName) maxName = x.name.length;
      });
      r.results.forEach(function (x) {
        var pad = x.name + " ".repeat(maxName - x.name.length + 2);
        var out = (x.output || "").replace(/\n/g, " ").substring(0, 80);
        console.log(
          (x.ok ? "OK" : "FAIL") +
            "  " +
            pad +
            out +
            (x.ms ? "  (" + x.ms + "ms)" : ""),
        );
      });
      console.log(
        "\n--- " +
          r.results.filter(function (x) {
            return x.ok;
          }).length +
          "/" +
          r.results.length +
          " passed (" +
          dt +
          "ms total) ---",
      );
    } else {
      console.error("FAIL:", r.error || JSON.stringify(r));
    }
  } else if (cmd === "messages" || cmd === "msg" || cmd === "m") {
    const r = await get(
      "/brain/messages" + (arg === "peek" ? "?clear=false" : ""),
    );
    if (r.count === 0) {
      console.log("(no new messages)");
    } else {
      r.messages.forEach(function (m) {
        console.log("[" + m.time + "] " + m.text);
      });
    }
  } else if (cmd === "screen" || cmd === "scr") {
    const sub = process.argv[3] || "sources";
    if (sub === "sources" || sub === "src") {
      const r = await get("/screen/sources");
      console.log("Available:", (r.available || []).join(", ") || "(none)");
      var srcs = r.sources || {};
      for (var k in srcs) {
        console.log(
          "  " + k + ": " + srcs[k].status + " " + (srcs[k].url || ""),
        );
      }
      if (r.best) console.log("Best:", r.best.name, r.best.url);
    } else if (sub === "capture" || sub === "cap") {
      const mode = process.argv[4] || "auto";
      const r = await get("/screen/capture?mode=" + mode);
      if (r.ok) {
        console.log("Capture OK (source: " + (r.source || "?") + ")");
        if (r.image) console.log("Image: " + r.image.substring(0, 60) + "...");
      } else {
        console.error("FAIL:", r.error);
      }
    } else {
      console.log("Usage: node brain.js screen <sources|capture> [mode]");
    }
  } else if (cmd === "input" || cmd === "i") {
    const action = process.argv[3];
    if (!action) {
      console.log(
        "Usage: node brain.js input <tap|swipe|key|text|home|back|...> [params as JSON]",
      );
      console.log("Examples:");
      console.log("  node brain.js input home");
      console.log('  node brain.js input tap \'{"x":540,"y":960}\'');
      console.log('  node brain.js input text \'{"text":"hello"}\'');
    } else {
      var params = {};
      if (process.argv[4]) {
        try {
          params = JSON.parse(process.argv[4]);
        } catch (e) {
          params = { text: process.argv[4] };
        }
      }
      const r = await post("/input/" + action, params);
      console.log(r.ok ? "OK" : "FAIL", JSON.stringify(r));
    }
  } else if (cmd === "status" || cmd === "st") {
    const r = await get("/status");
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === "relay" || cmd === "r") {
    const r = await get("/brain/relay");
    if (r.ok) {
      console.log("Relay:", r.relay);
      console.log("Agents:", JSON.stringify(r.agents, null, 2));
    } else {
      console.log("No relay found");
    }
  } else if (cmd === "guardian" || cmd === "g") {
    const action = arg || "diagnose";
    console.log("Running guardian (" + action + ")...");
    const r = await post("/brain/guardian", { action: action });
    if (r.ok) {
      console.log(r.output);
    } else {
      console.error("FAIL:", r.error || r.output);
    }
  } else {
    console.log(
      "Usage: node brain.js <command> [args]\n\nCommands:\n  exec|x <cmd>       Execute command on agent\n  state|s             Get hub state\n  status|st           Get full system status\n  say <text>          Send message to sense UI\n  terminal|t [n]      Get last N terminal entries\n  sysinfo|si          Request system info from agent\n  auto|a              Run auto-diagnostics\n  messages|m [peek]   Get user messages\n  screen|scr <sub>    Screen: sources, capture [mode]\n  input|i <action>    Send input: tap, key, text, home, back, ...\n  relay|r             Check relay status\n  guardian|g [action]  Run desktop guardian",
    );
  }
}

main().catch((e) => console.error(e.message));
