const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ── Track connected therapists ──
// Map of therapistName -> Set of WebSocket connections
const therapistConnections = new Map();
const receptionConnections = new Set();

wss.on("connection", (ws) => {
  let registeredName = null;
  let isReception = false;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);

      // ── Therapist registers themselves ──
      if (msg.type === "register-therapist") {
        registeredName = msg.name;
        if (!therapistConnections.has(registeredName)) {
          therapistConnections.set(registeredName, new Set());
        }
        therapistConnections.get(registeredName).add(ws);
        console.log(`✓ ${registeredName} connected`);

        // Tell reception about the updated online list
        broadcastOnlineList();
      }

      // ── Reception registers ──
      if (msg.type === "register-reception") {
        isReception = true;
        receptionConnections.add(ws);
        console.log("✓ Reception connected");

        // Send current online list to this reception
        ws.send(JSON.stringify({
          type: "online-list",
          online: getOnlineList(),
        }));
      }

      // ── Reception sends a notification ──
      if (msg.type === "notify") {
        const { therapist, clientName, voiceEnabled } = msg;
        console.log(`🔔 Notifying ${therapist}: ${clientName} has arrived`);

        const notification = {
          type: "arrival",
          id: Date.now().toString(),
          therapist,
          clientName,
          voiceEnabled,
          time: new Date().toISOString(),
        };

        // Send ONLY to the target therapist
        const connections = therapistConnections.get(therapist);
        if (connections) {
          connections.forEach((client) => {
            if (client.readyState === 1) {
              client.send(JSON.stringify(notification));
            }
          });
        }

        // Confirm back to all reception screens
        receptionConnections.forEach((client) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              type: "notify-confirmed",
              therapist,
              clientName,
              time: notification.time,
            }));
          }
        });
      }
    } catch (e) {
      console.error("Message error:", e);
    }
  });

  ws.on("close", () => {
    if (registeredName && therapistConnections.has(registeredName)) {
      therapistConnections.get(registeredName).delete(ws);
      if (therapistConnections.get(registeredName).size === 0) {
        therapistConnections.delete(registeredName);
      }
      console.log(`✗ ${registeredName} disconnected`);
      broadcastOnlineList();
    }
    if (isReception) {
      receptionConnections.delete(ws);
      console.log("✗ Reception disconnected");
    }
  });
});

function getOnlineList() {
  return Array.from(therapistConnections.keys());
}

function broadcastOnlineList() {
  const msg = JSON.stringify({
    type: "online-list",
    online: getOnlineList(),
  });
  receptionConnections.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

// ── Serve the frontend ──
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── Start server ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🏥 Client Arrival Notifier running on port ${PORT}\n`);
});
