const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const HOST = "0.0.0.0";

// HTTP-server som även visar spelet
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const file = path.join(__dirname, "Kaos_pa_On_multiplayer_READY.html");

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Kunde inte ladda spelet.");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });

      res.end(data);
    });

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// WebSocket-server
const wss = new WebSocket.Server({ server });

const players = new Map();
const rooms = new Map();

const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function id() {
  return Math.random().toString(36).slice(2, 10);
}

function code() {
  let c;

  do {
    c = "";

    for (let i = 0; i < 4; i++) {
      c += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(c));

  return c;
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function state(room) {
  const out = {};

  for (const [pid, p] of players) {
    if (p.room === room) {
      out[pid] = {
        x: p.x,
        y: p.y,
        hp: p.hp,
        alive: p.alive,
        color: p.color
      };
    }
  }

  return out;
}

function broadcast(room, obj) {
  for (const [, p] of players) {
    if (p.room === room) {
      send(p.ws, obj);
    }
  }
}

wss.on("connection", ws => {
  const pid = id();

  const p = {
    ws,
    room: null,
    x: 550,
    y: 330,
    hp: 100,
    alive: true,
    color: "#22c55e"
  };

  players.set(pid, p);

  send(ws, {
    type: "welcome",
    id: pid
  });

  ws.on("message", raw => {
    let d;

    try {
      d = JSON.parse(raw);
    } catch {
      return;
    }

    // SKAPA RUM
    if (d.type === "create_room") {
      if (p.room) return;

      const c = code();

      rooms.set(c, new Set([pid]));
      p.room = c;

      send(ws, {
        type: "room_created",
        code: c,
        players: state(c)
      });

      broadcast(c, {
        type: "room_state",
        players: state(c)
      });
    }

    // GÅ MED I RUM
    else if (d.type === "join_room") {
      const c = String(d.code || "").toUpperCase();
      const r = rooms.get(c);

      if (!r) {
        send(ws, {
          type: "room_error",
          message: "Rummet finns inte."
        });
        return;
      }

      if (r.size >= 8) {
        send(ws, {
          type: "room_error",
          message: "Rummet är fullt."
        });
        return;
      }

      if (p.room) return;

      r.add(pid);
      p.room = c;

      send(ws, {
        type: "room_joined",
        code: c,
        players: state(c)
      });

      broadcast(c, {
        type: "room_state",
        players: state(c)
      });
    }

    // RÖRELSE
    else if (d.type === "move" && p.room) {
      p.x = Math.max(
        70,
        Math.min(1030, Number(d.x) || 550)
      );

      p.y = Math.max(
        70,
        Math.min(580, Number(d.y) || 330)
      );

      p.hp = Math.max(
        0,
        Math.min(100, Number(d.hp) ?? p.hp)
      );

      broadcast(p.room, {
        type: "room_state",
        players: state(p.room)
      });
    }

    // KNUFF
    else if (d.type === "knock" && p.room) {
      for (const [oid, o] of players) {
        if (
          oid === pid ||
          o.room !== p.room ||
          !o.alive
        ) {
          continue;
        }

        const dx = o.x - p.x;
        const dy = o.y - p.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 65) {
          const len = dist || 1;

          o.x += (dx / len) * 100;
          o.y += (dy / len) * 100;

          o.hp = Math.max(0, o.hp - 10);

          if (
            o.x < 70 ||
            o.x > 1030 ||
            o.y < 70 ||
            o.y > 580
          ) {
            o.alive = false;
            o.hp = 0;

            broadcast(p.room, {
              type: "knock",
              message: "💥 En spelare åkte ut!"
            });

            setTimeout(() => {
              if (
                players.has(oid) &&
                o.room === p.room
              ) {
                o.alive = true;
                o.hp = 100;
                o.x = 550;
                o.y = 330;

                broadcast(p.room, {
                  type: "room_state",
                  players: state(p.room)
                });
              }
            }, 1500);
          } else {
            send(o.ws, {
              type: "hit",
              hp: o.hp
            });
          }
        }
      }

      broadcast(p.room, {
        type: "room_state",
        players: state(p.room)
      });
    }
  });

  ws.on("close", () => {
    const old = p.room;

    if (old) {
      const r = rooms.get(old);

      if (r) {
        r.delete(pid);

        if (!r.size) {
          rooms.delete(old);
        } else {
          broadcast(old, {
            type: "room_state",
            players: state(old)
          });
        }
      }
    }

    players.delete(pid);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🏝️ Kaos på Ön körs på port ${PORT}`);
});