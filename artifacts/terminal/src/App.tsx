import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { io, Socket } from "socket.io-client";
import "@xterm/xterm/css/xterm.css";

export default function App() {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!termRef.current) return;

    // Initialize xterm.js terminal with a dark theme resembling Ubuntu/Kali
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, "DejaVu Sans Mono", monospace',
      theme: {
        background: "#0d0d0d",
        foreground: "#d4d4d4",
        cursor: "#00ff41",
        cursorAccent: "#000000",
        black: "#1e1e1e",
        red: "#f44747",
        green: "#6a9955",
        yellow: "#d7ba7d",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#4ec9b0",
        white: "#d4d4d4",
        brightBlack: "#555555",
        brightRed: "#f44747",
        brightGreen: "#6a9955",
        brightYellow: "#d7ba7d",
        brightBlue: "#569cd6",
        brightMagenta: "#c586c0",
        brightCyan: "#4ec9b0",
        brightWhite: "#ffffff",
        selectionBackground: "#264f78",
      },
      allowTransparency: false,
      scrollback: 5000,
    });

    // FitAddon resizes the terminal columns/rows to fill the container
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    term.open(termRef.current);
    fitAddon.fit();

    // Connect to the backend WebSocket server (socket.io)
    // The BASE_URL already includes the base path prefix for the proxy
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    const wsUrl = `${window.location.protocol}//${window.location.host}`;
    const socket: Socket = io(wsUrl, {
      path: `/api/terminal/socket.io`,
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      // Once connected, tell backend the initial terminal size
      const dims = { cols: term.cols, rows: term.rows };
      socket.emit("resize", dims);
    });

    // Receive PTY output from backend and write to xterm
    socket.on("output", (data: string) => {
      term.write(data);
    });

    socket.on("disconnect", () => {
      term.write("\r\n\x1b[31m[Connection closed]\x1b[0m\r\n");
    });

    socket.on("connect_error", () => {
      term.write("\r\n\x1b[31m[Failed to connect to shell]\x1b[0m\r\n");
    });

    // When user types, send keystrokes over WebSocket to the PTY process
    term.onData((data: string) => {
      socket.emit("input", data);
    });

    // On terminal resize, send new dimensions to backend so PTY matches
    term.onResize(({ cols, rows }) => {
      socket.emit("resize", { cols, rows });
    });

    // Re-fit on window resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      socket.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0d0d0d",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Terminal title bar */}
      <div
        style={{
          background: "#1a1a2e",
          borderBottom: "1px solid #2d2d4e",
          padding: "6px 16px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", gap: "6px", marginRight: "8px" }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <span
          style={{
            color: "#888",
            fontSize: "13px",
            fontFamily: "monospace",
            letterSpacing: "0.5px",
          }}
        >
          bash — Web Terminal
        </span>
      </div>

      {/* xterm.js mount point — fills remaining height */}
      <div
        ref={termRef}
        style={{
          flex: 1,
          padding: "8px",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
