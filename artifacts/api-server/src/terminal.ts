import { Server as SocketIOServer } from "socket.io";
import { type Server as HttpServer } from "node:http";
import * as pty from "node-pty";
import { logger } from "./lib/logger";

/**
 * Attaches socket.io to the HTTP server and sets up the node-pty pipeline.
 *
 * Data flow:
 *   Browser xterm.js  →  socket "input"  →  ptyProcess.write()   (user keystrokes → bash)
 *   ptyProcess.onData → socket "output"  →  term.write()         (bash output → browser)
 *   Browser resize    →  socket "resize" →  ptyProcess.resize()  (keep cols/rows in sync)
 */
export function attachTerminal(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    // Mount socket.io under /api/terminal so the shared reverse proxy routes it
    path: "/api/terminal/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Terminal client connected");

    // Spawn a real bash shell via node-pty
    const ptyProcess = pty.spawn("bash", [], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || "/home",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: "en_US.UTF-8",
      } as Record<string, string>,
    });

    // Pipe PTY output → browser (bash stdout/stderr → xterm.js)
    ptyProcess.onData((data: string) => {
      socket.emit("output", data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      logger.info({ socketId: socket.id, exitCode }, "PTY process exited");
      socket.emit("output", `\r\n\x1b[33m[Shell exited with code ${exitCode}]\x1b[0m\r\n`);
      socket.disconnect();
    });

    // Pipe browser keystrokes → PTY (xterm.js input → bash stdin)
    socket.on("input", (data: string) => {
      try {
        ptyProcess.write(data);
      } catch {
        // PTY may have already closed
      }
    });

    // Sync terminal dimensions whenever the browser window is resized
    socket.on("resize", ({ cols, rows }: { cols: number; rows: number }) => {
      try {
        ptyProcess.resize(
          Math.max(2, Math.min(cols, 500)),
          Math.max(2, Math.min(rows, 200)),
        );
      } catch {
        // PTY may have already closed
      }
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Terminal client disconnected");
      try {
        ptyProcess.kill();
      } catch {
        // Already dead
      }
    });
  });

  logger.info("Terminal WebSocket server attached at /api/terminal/socket.io");
}
