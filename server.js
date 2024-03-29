const express = require("express");
const expressWs = require("express-ws");
const cors = require("cors");
const os = require("os");
const pty = require("node-pty");
const app = express();
expressWs(app);

let terminals = {},
  logs = {};

const USE_BINARY = os.platform() !== "win32";

app.use(cors()); // cors 해제

app.post("/terminals", (req, res) => {
  const env = Object.assign({}, process.env);
  env["COLORTERM"] = "truecolor";
  var cols = parseInt(req.query.cols),
    rows = parseInt(req.query.rows),
    term = pty.spawn(process.platform === "win32" ? "cmd.exe" : "bash", [], {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd: env.PWD,
      env: env,
      encoding: USE_BINARY ? null : "utf8",
    });

  console.log("Created terminal with PID: " + term.pid);
  terminals[term.pid] = term;
  logs[term.pid] = "";
  term.on("data", function (data) {
    logs[term.pid] += data;
  });
  res.send(term.pid.toString());
  res.end();
});

app.post("/terminals/:pid/size", (req, res) => {
  var pid = parseInt(req.params.pid),
    cols = parseInt(req.query.cols),
    rows = parseInt(req.query.rows),
    term = terminals[pid];

  term.resize(cols, rows);
  console.log(
    "Resized terminal " + pid + " to " + cols + " cols and " + rows + " rows."
  );
  res.end();
});

app.ws("/terminals/:pid", function (ws, req) {
  var term = terminals[parseInt(req.params.pid)];
  console.log("Connected to terminal " + term.pid);
  ws.send(logs[term.pid]);

  // string message buffering
  function buffer(socket, timeout) {
    let s = "";
    let sender = null;
    return (data) => {
      s += data;
      if (!sender) {
        sender = setTimeout(() => {
          socket.send(s);
          s = "";
          sender = null;
        }, timeout);
      }
    };
  }
  // binary message buffering
  function bufferUtf8(socket, timeout) {
    let buffer = [];
    let sender = null;
    let length = 0;
    return (data) => {
      buffer.push(data);
      length += data.length;
      if (!sender) {
        sender = setTimeout(() => {
          socket.send(Buffer.concat(buffer, length));
          buffer = [];
          sender = null;
          length = 0;
        }, timeout);
      }
    };
  }
  const send = USE_BINARY ? bufferUtf8(ws, 5) : buffer(ws, 5);

  term.on("data", function (data) {
    try {
      send(data);
    } catch (ex) {
      // The WebSocket is not open, ignore
    }
  });
  ws.on("message", function (msg) {
    term.write(msg);
  });
  ws.on("close", function () {
    term.kill();
    console.log("Closed terminal " + term.pid);
    // Clean things up
    delete terminals[term.pid];
    delete logs[term.pid];
  });
});

let port = process.env.PORT || 5000,
  host = os.platform() === "win32" ? "127.0.0.1" : "0.0.0.0";

console.log("App listening to http://127.0.0.1:" + port);
app.listen(port, host);
