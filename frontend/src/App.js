import React, { useEffect, useMemo, useRef, useState } from "react";
import * as signalR from "@microsoft/signalr";
import "./App.css";

const API = (process.env.REACT_APP_API_BASE || "http://localhost:5087").replace(
  /\/$/,
  ""
);

export default function App() {
  // auth
  const [alias, setAlias] = useState(localStorage.getItem("alias") || "");
  const [userId, setUserId] = useState(
    parseInt(localStorage.getItem("userId") || "0", 10)
  );

  // ui state
  const [users, setUsers] = useState([]); // picker için kullanıcılar
  const [chats, setChats] = useState([]); // sol liste: { peer:{id,alias}, lastText, lastAt }
  const [peer, setPeer] = useState(null); // seçili kişi
  const [thread, setThread] = useState([]); // aktif konuşma mesajları
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // unread badge
  const [unread, setUnread] = useState({});

  // alias cache (id -> alias)
  const [aliasMap, setAliasMap] = useState({});

  // signalR
  const [conn, setConn] = useState(null);
  const prevPeerRef = useRef(null);
  const livePeerRef = useRef(null);
  const seenIdsRef = useRef(new Set()); // mesaj id bazlı duplicate koruması

  const messagesRef = useRef(null);
  const bottomRef = useRef(null);

  const usersRef = useRef([]);
  const aliasMapRef = useRef({});

  // helpers
  async function readJson(res, label) {
    const txt = await res.text();
    if (!res.ok)
      throw new Error(`${label} ${res.status}: ${txt || res.statusText}`);
    return txt ? JSON.parse(txt) : null;
  }

  function scrollToBottom(behavior = "auto") {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    if (messagesRef.current) {
      requestAnimationFrame(() => {
        const el = messagesRef.current;
        el.scrollTop = el.scrollHeight;
      });
    }
  }

  function logout() {
    localStorage.clear();
    setUserId(0);
    setAlias("");
    setUsers([]);
    setChats([]);
    setPeer(null);
    setThread([]);
    setUnread({});
    try {
      conn?.stop();
    } catch {}
    setConn(null);
  }

  // id için alias'ı tek yerden çöz (cache -> users/peer -> msg -> #id)
  function getAliasFor(otherId, aliasFromMsg) {
    const fromCache = aliasMapRef.current[otherId];
    if (fromCache) return fromCache;

    const fromUsers =
      usersRef.current.find((u) => u.id === otherId)?.alias ||
      (peer && peer.id === otherId ? peer.alias : null);
    if (fromUsers) {
      const next = { ...aliasMapRef.current, [otherId]: fromUsers };
      aliasMapRef.current = next;
      setAliasMap((m) => ({ ...m, [otherId]: fromUsers }));
      return fromUsers;
    }

    if (aliasFromMsg) {
      const next = { ...aliasMapRef.current, [otherId]: aliasFromMsg };
      aliasMapRef.current = next;
      setAliasMap((m) => ({ ...m, [otherId]: aliasFromMsg }));
      return aliasFromMsg;
    }

    setTimeout(() => {
      fetch(`${API}/users`)
        .then((r) => (r.ok ? r.json() : []))
        .then((arr) => {
          if (Array.isArray(arr)) {
            const next = { ...aliasMapRef.current };
            for (const u of arr) next[u.id] = u.alias;
            aliasMapRef.current = next;
            setAliasMap(next);
          }
        })
        .catch(() => {});
    }, 0);

    return `#${otherId}`;
  }

  // login users çek
  useEffect(() => {
    if (userId <= 0) return;
    (async () => {
      try {
        const res = await fetch(`${API}/users`);
        const list = await readJson(res, "GET /users");
        setUsers(Array.isArray(list) ? list : []);
        if (Array.isArray(list)) {
          usersRef.current = list;
          const next = { ...aliasMapRef.current };
          for (const u of list) next[u.id] = u.alias;
          aliasMapRef.current = next;
          setAliasMap(next);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [userId]);

  // users güncellenince sol listedeki aliaslar refresh
  useEffect(() => {
    if (users.length === 0) return;
    usersRef.current = users;
    setChats((prev) =>
      prev.map((c) => {
        if (!c?.peer) return c;
        const u = users.find((x) => x.id === c.peer.id);
        if (!u) return c;
        if (c.peer.alias !== u.alias) {
          return { ...c, peer: { ...c.peer, alias: u.alias } };
        }
        return c;
      })
    );
  }, [users]);

  async function refreshChats() {
    try {
      const res = await fetch(`${API}/messages?userId=${userId}&limit=500`);
      const list = await readJson(res, "GET /messages");

      const map = new Map();

      for (const m of list || []) {
        const me = Number(userId);
        const uid = Number(m.userId ?? m.UserId);
        const rid = Number(m.receiverId ?? m.ReceiverId);
        const other = uid === me ? rid : uid;

        const otherIsReceiver = other === rid;
        const aliasFromMsg = otherIsReceiver
          ? m.receiverAlias ?? m.ReceiverAlias ?? null
          : m.senderAlias ?? m.SenderAlias ?? null;

        const aliasResolved = getAliasFor(other, aliasFromMsg);

        const createdAt = new Date(m.createdAt ?? m.CreatedAt ?? Date.now());
        const last = map.get(other);

        if (!last || createdAt > last.lastAt) {
          map.set(other, {
            peer: { id: other, alias: aliasResolved },
            lastText: (m.text ?? m.Text) || "",
            lastAt: createdAt,
          });
        }
      }

      const arr = Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt);
      setChats(arr);

      // önceki seçimi geri yükleme
      const lastPeerId = parseInt(
        localStorage.getItem("lastPeerId") || "0",
        10
      );
      if (lastPeerId) {
        const found = arr.find((c) => c.peer.id === lastPeerId);
        if (found) setPeer(found.peer);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // alias oluştur (auth)
  async function createAlias() {
    const name = alias.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/auth/alias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: name }),
      });
      const data = await readJson(res, "POST /auth/alias");
      setUserId(data.userId);
      localStorage.setItem("userId", String(data.userId));
      localStorage.setItem("alias", name);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // thread sayısı değişince sayfayı alta kaydırma
  useEffect(() => {
    if (thread.length > 0) scrollToBottom("auto");
  }, [thread.length]); // eslint-disable-line

  // users geldikten sonra sohbet listesini oluştur + unreadleri çek
  useEffect(() => {
    if (userId > 0 && users.length > 0) {
      refreshChats();
    }
  }, [users, userId]); // eslint-disable-line

  // livePeerRef her değişimde güncel kalsın diye bu useEffecti ekledim
  useEffect(() => {
    livePeerRef.current = peer || null;
  }, [peer]);

  // SignalR bağlantısı
  useEffect(() => {
    if (userId <= 0) return;

    const c = new signalR.HubConnectionBuilder()
      .withUrl(`${API}/hubs/chat`)
      .withAutomaticReconnect()
      .build();

    c.start()
      .then(async () => {
        setConn(c);
        try {
          await c.invoke("JoinUser", userId);
        } catch {}

        // açılışta unreadleri çek
        try {
          const res = await fetch(`${API}/inbox/unread?me=${userId}`);
          const arr = await readJson(res, "GET /inbox/unread");
          const map = {};
          for (const row of arr || []) map[row.peerId] = row.count;
          setUnread(map);
        } catch {}

        // thread içi mesaj
        c.on("message", (msg) => {
          const me = Number(userId);
          const from = Number(msg.userId ?? msg.UserId);
          const to = Number(msg.receiverId ?? msg.ReceiverId);
          const other = from === me ? to : from;

          const active =
            livePeerRef.current && Number(livePeerRef.current.id) === other;

          const id = msg.id ?? msg.Id;
          if (seenIdsRef.current.has(id)) return;
          seenIdsRef.current.add(id);

          if (active) {
            setThread((prev) => [...prev, msg]);
            setTimeout(() => scrollToBottom("smooth"), 0);
          } else {
            setUnread((u) => ({ ...u, [other]: (u[other] || 0) + 1 }));
          }

          const lastAt = new Date(msg.createdAt ?? msg.CreatedAt ?? Date.now());

          setChats((prev) => {
            const copy = prev.slice();
            const i = copy.findIndex((c) => c.peer.id === other);
            if (i >= 0) {
              copy[i] = {
                ...copy[i],
                lastText: (msg.text ?? msg.Text) || "",
                lastAt,
              };
              return copy.sort((a, b) => b.lastAt - a.lastAt);
            } else {
              const otherIsReceiver = other === to;
              const aliasFromMsg = otherIsReceiver
                ? msg.receiverAlias ?? msg.ReceiverAlias ?? null
                : msg.senderAlias ?? msg.SenderAlias ?? null;
              const aliasResolved = getAliasFor(other, aliasFromMsg);

              copy.unshift({
                peer: { id: other, alias: aliasResolved },
                lastText: (msg.text ?? msg.Text) || "",
                lastAt,
              });
              return copy;
            }
          });
        });

        // inbox notification kısmı
        c.on("inbox:new", ({ message }) => {
          const me = Number(userId);
          const from = Number(message.userId ?? message.UserId);
          const to = Number(message.receiverId ?? message.ReceiverId);
          const other = from === me ? to : from;

          const active =
            livePeerRef.current && Number(livePeerRef.current.id) === other;

          if (!active) {
            setUnread((u) => ({ ...u, [other]: (u[other] || 0) + 1 }));
          }

          const lastAt = new Date(
            message.createdAt ?? message.CreatedAt ?? Date.now()
          );

          setChats((prev) => {
            const copy = prev.slice();
            const i = copy.findIndex((c) => c.peer.id === other);
            if (i >= 0) {
              copy[i] = {
                ...copy[i],
                lastText: (message.text ?? message.Text) || "",
                lastAt,
              };
              return copy.sort((a, b) => b.lastAt - a.lastAt);
            } else {
              const otherIsReceiver = other === to;
              const aliasFromMsg = otherIsReceiver
                ? message.receiverAlias ?? message.ReceiverAlias ?? null
                : message.senderAlias ?? message.SenderAlias ?? null;
              const aliasResolved = getAliasFor(other, aliasFromMsg);

              copy.unshift({
                peer: { id: other, alias: aliasResolved },
                lastText: (message.text ?? message.Text) || "",
                lastAt,
              });
              return copy;
            }
          });
        });
      })
      .catch(console.error);

    return () => {
      try {
        c.stop();
      } catch {}
    };
  }, [userId]); // eslint-disable-line

  // Peer değiştiyse
  useEffect(() => {
    if (userId <= 0) return;

    const prev = prevPeerRef.current?.id;
    const cur = peer?.id;

    (async () => {
      try {
        if (conn && prev) await conn.invoke("LeaveThread", userId, prev);
      } catch {}
      seenIdsRef.current.clear();

      if (conn && cur) {
        try {
          await conn.invoke("JoinThread", userId, cur);
        } catch {}
        await loadThread(cur);
        localStorage.setItem("lastPeerId", String(cur));

        // okundu işaretle ve badge sıfırla
        try {
          await fetch(`${API}/messages/mark-read?me=${userId}&peer=${cur}`, {
            method: "POST",
          });
          setUnread((u) => ({ ...u, [cur]: 0 }));
        } catch {}
      } else {
        setThread([]);
      }
      prevPeerRef.current = peer || null;
    })();
  }, [peer?.id, conn, userId]); // eslint-disable-line

  async function loadThread(peerId) {
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/messages/thread?userA=${userId}&userB=${peerId}&limit=200`
      );
      const list = await readJson(res, "GET /messages/thread");
      setThread(Array.isArray(list) ? list : []);
      for (const m of list || []) seenIdsRef.current.add(m.id ?? m.Id);
      setTimeout(() => scrollToBottom("auto"), 0);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const canSend = useMemo(
    () => userId > 0 && peer?.id && text.trim().length > 0 && !busy,
    [userId, peer, text, busy]
  );

  // mesaj gönderme
  async function sendMessage() {
    const t = text.trim();
    if (!t || !peer?.id) return;
    setBusy(true);
    try {
      await fetch(`${API}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, receiverId: peer.id, text: t }),
      }).then((r) => readJson(r, "POST /messages"));

      setText("");
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  //sadece alias girilerek olusturdugumuz auth kısmı, şifrelendirme ile gerçek bir projede secure yapılmalı
  if (userId <= 0) {
    return (
      <div className="screen center">
        <div className="brandLine">
          <span className="brandMark">✦</span>
          <span className="brandName">SentimentalChat</span>
        </div>

        <div className="loginCard">
          <h1 className="loginTitle">Sentimental Chat’e Katılın</h1>
          <p className="loginSubtitle">
            Sohbete başlamak için bir takma ad oluşturun.
          </p>

          <label className="label">Takma Adınız</label>
          <input
            className="input"
            placeholder="Takma adınızı girin"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" ? createAlias() : null)}
            autoFocus
          />

          <button
            className="btn primary full"
            onClick={createAlias}
            disabled={busy || !alias.trim()}
          >
            {busy ? "Kaydediliyor..." : "Sohbete Başla"}
          </button>
        </div>
      </div>
    );
  }

  // chat alanı, sol orta vs
  return (
    <div style={{ display: "flex", height: "100vh", background: "#f5f7fb" }}>
      {/* sadece chatleştiğim kişileri görmek için ve badge kısmı*/}
      <aside
        style={{
          width: 300,
          borderRight: "1px solid #e5e7eb",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "relative",
          }}
        >
          <div style={{ fontWeight: 800 }}>Sohbetler</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              title="Yeni sohbet"
              onClick={() => setPickerOpen((v) => !v)}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "1px solid #c7d2fe",
                background: "#eef2ff",
                color: "#4338ca",
                fontWeight: 800,
                cursor: "pointer",
                lineHeight: "26px",
                textAlign: "center",
              }}
            >
              +
            </button>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              {alias} (#{userId})
            </div>
          </div>

          {/* + menü kısmı (sohbet başlatmak için kullanıcı seçme) */}
          {pickerOpen && (
            <div
              style={{
                position: "absolute",
                top: 48,
                right: 12,
                zIndex: 50,
                width: 240,
                maxHeight: 320,
                overflowY: "auto",
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                boxShadow: "0 8px 30px rgba(0,0,0,.08)",
                padding: 6,
              }}
            >
              {(users || [])
                .filter((u) => u.id !== userId)
                .map((u) => (
                  <div
                    key={u.id}
                    onClick={() => {
                      setPeer({ id: u.id, alias: u.alias });
                      setPickerOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f3f4f6")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <Avatar name={u.alias} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{u.alias}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        #{u.id}
                      </div>
                    </div>
                    {!!unread[u.id] && <Badge count={unread[u.id]} />}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* sol liste */}
        <div style={{ padding: 10, overflowY: "auto" }}>
          {chats.length === 0 && (
            <div style={{ color: "#9ca3af", fontSize: 14, padding: 8 }}>
              Henüz sohbet yok. “+” ile başlat.
            </div>
          )}
          {chats.map((c) => {
            const active = peer?.id === c.peer.id;
            return (
              <div
                key={c.peer.id}
                onClick={() => setPeer(c.peer)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 12,
                  cursor: "pointer",
                  background: active ? "#eef2ff" : "transparent",
                  border: active
                    ? "1px solid #c7d2fe"
                    : "1px solid transparent",
                  marginBottom: 8,
                }}
              >
                <Avatar name={c.peer.alias} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{c.peer.alias}</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 160,
                    }}
                  >
                    {c.lastText || "Mesaj yok"}
                  </div>
                </div>
                {!!unread[c.peer.id] && <Badge count={unread[c.peer.id]} />}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: "auto",
            padding: 12,
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            gap: 8,
          }}
        >
          <button className="link" onClick={logout}>
            Çıkış
          </button>
          <button
            className="link"
            onClick={async () => {
              if (!window.confirm("Tüm mesajlar silinsin mi?")) return;
              await fetch(`${API}/admin/messages`, { method: "DELETE" });
              setThread([]);
              setChats([]);
              setUnread({});
            }}
          >
            Mesajları Sıfırla
          </button>
        </div>
      </aside>

      {/* orta kısım*/}
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div
          style={{
            height: 56,
            background: "#fff",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 16px",
          }}
        >
          {peer ? (
            <>
              <Avatar name={peer.alias} />
              <div style={{ fontWeight: 700 }}>{peer.alias}</div>
              <div
                style={{ marginLeft: "auto", color: "#6b7280", fontSize: 13 }}
              >
                UserId: {userId} • Alias: {alias}
              </div>
            </>
          ) : (
            <div style={{ color: "#9ca3af" }}>
              Sol taraftan bir sohbet seçin veya “+” ile başlatın.
            </div>
          )}
        </div>

        {/* mesajlar kısmı */}
        <div
          ref={messagesRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            background: "#f5f7fb",
          }}
        >
          {!peer && (
            <div
              style={{ color: "#9ca3af", textAlign: "center", marginTop: 20 }}
            >
              Kişi seçiniz.
            </div>
          )}

          {peer && loading && (
            <div
              style={{ color: "#9ca3af", textAlign: "center", marginTop: 20 }}
            >
              Yükleniyor…
            </div>
          )}

          {peer &&
            !loading &&
            thread.map((m) => {
              const fromMe = Number(m.userId ?? m.UserId) === Number(userId);
              const label = String(
                m.sentimentLabel ?? m.SentimentLabel ?? "NEUTRAL"
              ).toUpperCase();
              const score = Number(m.sentimentScore ?? m.SentimentScore ?? 0);
              return (
                <div
                  key={m.id ?? m.Id}
                  style={{
                    display: "flex",
                    justifyContent: fromMe ? "flex-end" : "flex-start",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      maxWidth: 520,
                      background: fromMe ? "#4f46e5" : "#fff",
                      color: fromMe ? "#fff" : "#111827",
                      border:
                        "1px solid " + (fromMe ? "transparent" : "#e5e7eb"),
                      padding: "10px 12px",
                      borderRadius: 14,
                      boxShadow: "0 1px 6px #0000000e",
                    }}
                  >
                    <div style={{ whiteSpace: "pre-wrap" }}>
                      {m.text ?? m.Text}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 6,
                      }}
                    >
                      <SmallBadge
                        text={label}
                        color={
                          label === "POSITIVE"
                            ? "#16a34a"
                            : label === "NEGATIVE"
                            ? "#dc2626"
                            : "#6b7280"
                        }
                        bg={
                          label === "POSITIVE"
                            ? "#dcfce7"
                            : label === "NEGATIVE"
                            ? "#fee2e2"
                            : "#f3f4f6"
                        }
                      />
                      <span
                        style={{
                          fontSize: 12,
                          color: fromMe ? "#e0e7ff" : "#6b7280",
                        }}
                      >
                        skor: {score.toFixed(3)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          <div ref={bottomRef} />
        </div>

        <div
          style={{
            background: "#fff",
            borderTop: "1px solid #e5e7eb",
            padding: 12,
            display: "flex",
            gap: 8,
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder={peer ? `${peer.alias}…` : "Kişi seç…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" ? sendMessage() : null)}
            disabled={!peer}
          />
          <button className="btn" onClick={sendMessage} disabled={!canSend}>
            Gönder
          </button>
        </div>
      </main>
    </div>
  );
}

/* UI küçük parçalar */
function Avatar({ name }) {
  const letter = (name?.[0] || "?").toUpperCase();
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        background: "#eef2ff",
        color: "#4338ca",
        display: "grid",
        placeItems: "center",
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

function SmallBadge({ text, color, bg }) {
  return (
    <span
      style={{
        background: bg,
        color,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {text}
    </span>
  );
}

function Badge({ count }) {
  return (
    <div
      style={{
        minWidth: 18,
        height: 18,
        padding: "0 6px",
        borderRadius: 999,
        background: "#f43f5e",
        color: "#fff",
        fontSize: 12,
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {count}
    </div>
  );
}
