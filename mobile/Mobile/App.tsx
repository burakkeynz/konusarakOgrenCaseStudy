import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  Platform,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import * as signalR from '@microsoft/signalr';
import Config from 'react-native-config';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = String(Config.API_BASE_URL || '').replace(/\/$/, '');
console.log('API from .env =', Config.API_BASE_URL, '→ resolved =', API);
if (!API) console.warn('API_BASE_URL is not set in .env');

type Msg = {
  id?: number;
  Id?: number;
  userId?: number;
  UserId?: number;
  receiverId?: number;
  ReceiverId?: number;
  text?: string;
  Text?: string;
  createdAt?: string;
  CreatedAt?: string;
  sentimentLabel?: string;
  SentimentLabel?: string;
  sentimentScore?: number;
  SentimentScore?: number;
  senderAlias?: string;
  SenderAlias?: string;
  receiverAlias?: string;
  ReceiverAlias?: string;
};
type User = { id: number; alias: string };
type ChatRow = { peer: User; lastText: string; lastAt: number };

async function readJson(res: Response, label: string) {
  const txt = await res.text();
  if (!res.ok)
    throw new Error(`${label} ${res.status}: ${txt || res.statusText}`);
  return txt ? JSON.parse(txt) : null;
}
const showErr = (e: any, title = 'Hata') =>
  Alert.alert(title, e?.message ? String(e.message) : String(e));

export default function App() {
  return (
    <SafeAreaProvider>
      <InnerApp />
    </SafeAreaProvider>
  );
}

function InnerApp() {
  // AUTH
  const [alias, setAlias] = useState('');
  const [userId, setUserId] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  // Storage’dan başlangıç değerleri
  useEffect(() => {
    (async () => {
      try {
        const [savedAlias, savedUserId] = await Promise.all([
          AsyncStorage.getItem('alias'),
          AsyncStorage.getItem('userId'),
        ]);
        if (savedAlias) setAlias(savedAlias);
        if (savedUserId) setUserId(parseInt(savedUserId, 10) || 0);
      } catch {}
    })();
  }, []);

  // UI STATE
  const [users, setUsers] = useState<User[]>([]);
  const usersRef = useRef<User[]>([]);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const [aliasMap, setAliasMap] = useState<Record<number, string>>({});
  const aliasMapRef = useRef<Record<number, string>>({});
  useEffect(() => {
    aliasMapRef.current = aliasMap;
  }, [aliasMap]);

  const [chats, setChats] = useState<ChatRow[]>([]);
  const [peer, setPeer] = useState<User | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  // UNREAD
  const [unread, setUnread] = useState<Record<number, number>>({});

  // SIGNALR refs
  const connRef = useRef<signalR.HubConnection | null>(null);
  const prevPeerRef = useRef<User | null>(null);
  const livePeerRef = useRef<User | null>(null);
  const seenIdsRef = useRef<Set<number>>(new Set());

  // LIST REF
  const listRef = useRef<FlatList<Msg>>(null);

  // Safe scroll
  const safeScrollToBottom = (animated = false) => {
    if (!thread.length || !listRef.current) return;
    try {
      listRef.current.scrollToIndex({ index: 0, animated });
    } catch {
      setTimeout(() => {
        if (thread.length) {
          try {
            listRef.current?.scrollToIndex({ index: 0, animated });
          } catch {}
        }
      }, 16);
    }
  };

  // id alias çözümü
  function getAliasFor(otherId: number, aliasFromMsg?: string | null) {
    const fromCache = aliasMapRef.current[otherId];
    if (fromCache) return fromCache;

    const fromUsers =
      usersRef.current.find(u => u.id === otherId)?.alias ||
      (peer && peer.id === otherId ? peer.alias : null);
    if (fromUsers) {
      const next = { ...aliasMapRef.current, [otherId]: fromUsers };
      aliasMapRef.current = next;
      setAliasMap(next);
      return fromUsers;
    }

    if (aliasFromMsg) {
      const next = { ...aliasMapRef.current, [otherId]: aliasFromMsg };
      aliasMapRef.current = next;
      setAliasMap(next);
      return aliasFromMsg;
    }

    setTimeout(() => {
      fetch(`${API}/users`)
        .then(r => (r.ok ? r.json() : []))
        .then((arr: User[]) => {
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

  async function createAlias() {
    const name = alias.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/auth/alias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: name }),
      });
      const data = await readJson(res, 'POST /auth/alias');
      setUserId(data.userId);
      await AsyncStorage.setItem('userId', String(data.userId));
      await AsyncStorage.setItem('alias', name);
    } catch (e: any) {
      showErr(e);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (userId <= 0) return;
    (async () => {
      try {
        const res = await fetch(`${API}/users`);
        const list: User[] = await readJson(res, 'GET /users');
        const arr = Array.isArray(list) ? list : [];
        setUsers(arr);
        const next: Record<number, string> = { ...aliasMapRef.current };
        for (const u of arr) next[u.id] = u.alias;
        aliasMapRef.current = next;
        setAliasMap(next);
      } catch (e) {
        console.warn(e);
      }
    })();
  }, [userId]);

  // users değişince sohbet satır adlarını tazele
  useEffect(() => {
    if (users.length === 0) return;
    setChats(prev =>
      prev.map(c => {
        const u = users.find(x => x.id === c.peer.id);
        return u && c.peer.alias !== u.alias
          ? { ...c, peer: { ...c.peer, alias: u.alias } }
          : c;
      }),
    );
  }, [users]);

  async function refreshChats() {
    try {
      const res = await fetch(`${API}/messages?userId=${userId}&limit=500`);
      const list: Msg[] = await readJson(res, 'GET /messages');

      const map = new Map<number, ChatRow>();
      for (const m of list || []) {
        const me = Number(userId);
        const uid = Number(m.userId ?? m.UserId);
        const rid = Number(m.receiverId ?? m.ReceiverId);
        const other = uid === me ? rid : uid;

        const otherIsReceiver = other === rid;
        const aliasFromMsg = otherIsReceiver
          ? m.receiverAlias ?? m.ReceiverAlias ?? null
          : m.senderAlias ?? m.SenderAlias ?? null;

        const aliasResolved = getAliasFor(other, aliasFromMsg || undefined);
        const createdAt = new Date(
          m.createdAt ?? m.CreatedAt ?? Date.now(),
        ).getTime();

        const last = map.get(other);
        if (!last || createdAt > last.lastAt) {
          map.set(other, {
            peer: { id: other, alias: aliasResolved },
            lastText: (m.text ?? m.Text) || '',
            lastAt: createdAt,
          });
        }
      }

      const arr = Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt);
      setChats(arr);

      const lastPeerId = parseInt(
        (await AsyncStorage.getItem('lastPeerId')) || '0',
        10,
      );
      if (lastPeerId) {
        const found = arr.find(c => c.peer.id === lastPeerId);
        if (found) setPeer(found.peer);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  // users geldikten sonra sol liste + unread
  useEffect(() => {
    if (userId > 0 && users.length > 0) refreshChats();
  }, [users, userId]); // eslint-disable-line

  // live ref
  useEffect(() => {
    livePeerRef.current = peer;
  }, [peer]);

  // signalr
  useEffect(() => {
    if (userId <= 0) return;

    let alive = true;

    const c = new signalR.HubConnectionBuilder()
      .withUrl(`${API.replace(/\/$/, '')}/hubs/chat`, {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .build();

    connRef.current = c;

    const handleMessage = (msg: Msg) => {
      if (!alive) return;
      const me = Number(userId);
      const from = Number(msg.userId ?? msg.UserId);
      const to = Number(msg.receiverId ?? msg.ReceiverId);
      const other = from === me ? to : from;
      const active =
        !!livePeerRef.current && Number(livePeerRef.current.id) === other;

      const id = Number(msg.id ?? msg.Id);
      if (seenIdsRef.current.has(id)) return;
      seenIdsRef.current.add(id);

      if (active) {
        setThread(prev => {
          const next = [...prev, msg];
          setTimeout(() => safeScrollToBottom(true), 0);
          return next;
        });
      } else {
        setUnread(u => ({ ...u, [other]: (u[other] || 0) + 1 }));
      }

      const lastAt = new Date(
        msg.createdAt ?? msg.CreatedAt ?? Date.now(),
      ).getTime();

      setChats(prev => {
        const copy = prev.slice();
        const i = copy.findIndex(c => c.peer.id === other);
        if (i >= 0) {
          copy[i] = {
            ...copy[i],
            lastText: (msg.text ?? msg.Text) || '',
            lastAt,
          };
          return copy.sort((a, b) => b.lastAt - a.lastAt);
        } else {
          const otherIsReceiver = other === to;
          const aliasFromMsg = otherIsReceiver
            ? msg.receiverAlias ?? msg.ReceiverAlias ?? null
            : msg.senderAlias ?? msg.SenderAlias ?? null;

          if (aliasFromMsg && aliasMapRef.current[other] !== aliasFromMsg) {
            const next = { ...aliasMapRef.current, [other]: aliasFromMsg };
            aliasMapRef.current = next;
            setAliasMap(next);
          }

          const aliasResolved = getAliasFor(other, aliasFromMsg || undefined);

          copy.unshift({
            peer: { id: other, alias: aliasResolved },
            lastText: (msg.text ?? msg.Text) || '',
            lastAt,
          });
          return copy;
        }
      });
    };

    const handleInbox = ({ message }: { message: Msg }) => {
      const me = Number(userId);
      const from = Number(message.userId ?? message.UserId);
      const to = Number(message.receiverId ?? message.ReceiverId);
      const other = from === me ? to : from;

      const active =
        !!livePeerRef.current && Number(livePeerRef.current.id) === other;

      if (!active) setUnread(u => ({ ...u, [other]: (u[other] || 0) + 1 }));

      const lastAt = new Date(
        message.createdAt ?? message.CreatedAt ?? Date.now(),
      ).getTime();

      setChats(prev => {
        const copy = prev.slice();
        const i = copy.findIndex(c => c.peer.id === other);
        if (i >= 0) {
          copy[i] = {
            ...copy[i],
            lastText: (message.text ?? message.Text) || '',
            lastAt,
          };
          return copy.sort((a, b) => b.lastAt - a.lastAt);
        } else {
          const otherIsReceiver = other === to;
          const aliasFromMsg = otherIsReceiver
            ? message.receiverAlias ?? message.ReceiverAlias ?? null
            : message.senderAlias ?? message.SenderAlias ?? null;

          if (aliasFromMsg && aliasMapRef.current[other] !== aliasFromMsg) {
            const next = { ...aliasMapRef.current, [other]: aliasFromMsg };
            aliasMapRef.current = next;
            setAliasMap(next);
          }

          const aliasResolved = getAliasFor(other, aliasFromMsg || undefined);

          copy.unshift({
            peer: { id: other, alias: aliasResolved },
            lastText: (message.text ?? message.Text) || '',
            lastAt,
          });
          return copy;
        }
      });
    };

    c.on('message', handleMessage);
    c.on('inbox:new', handleInbox);

    c.onreconnected(async () => {
      try {
        await c.invoke('JoinUser', userId);
      } catch {}
      const cur = livePeerRef.current?.id;
      if (cur) {
        try {
          await c.invoke('JoinThread', userId, cur);
        } catch {}
      }
    });

    c.start()
      .then(async () => {
        try {
          await c.invoke('JoinUser', userId);
        } catch {}

        // unreadleri al
        try {
          const res = await fetch(`${API}/inbox/unread?me=${userId}`);
          const arr = await readJson(res, 'GET /inbox/unread'); // [{peerId, count}]
          const map: Record<number, number> = {};
          for (const row of arr || []) map[row.peerId] = row.count;
          if (alive) setUnread(map);
        } catch {}
      })
      .catch(err => console.warn('SignalR start error:', err));

    return () => {
      alive = false;
      try {
        c.off('message', handleMessage);
        c.off('inbox:new', handleInbox);
        c.stop();
      } catch {}
      connRef.current = null;
    };
  }, [userId]);

  //peer change kısmı leave vs
  useEffect(() => {
    if (userId <= 0) return;

    const prev = prevPeerRef.current?.id;
    const cur = peer?.id;

    (async () => {
      try {
        if (connRef.current && prev)
          await connRef.current.invoke('LeaveThread', userId, prev);
      } catch {}
      seenIdsRef.current.clear();

      if (connRef.current && cur) {
        try {
          await connRef.current.invoke('JoinThread', userId, cur);
        } catch {}
        await loadThread(cur);
        await AsyncStorage.setItem('lastPeerId', String(cur));
        try {
          await fetch(`${API}/messages/mark-read?me=${userId}&peer=${cur}`, {
            method: 'POST',
          });
          setUnread(u => ({ ...u, [cur]: 0 }));
        } catch {}
      } else {
        setThread([]);
      }
      prevPeerRef.current = peer || null;
    })();
  }, [peer?.id, userId]); // eslint-disable-line

  async function loadThread(peerId: number) {
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/messages/thread?userA=${userId}&userB=${peerId}&limit=200`,
      );
      const list: Msg[] = await readJson(res, 'GET /messages/thread');
      setThread(Array.isArray(list) ? list : []);
      for (const m of list || []) {
        const id = Number(m.id ?? m.Id);
        if (!Number.isNaN(id)) seenIdsRef.current.add(id);
      }
      setTimeout(() => {
        if (list?.length) safeScrollToBottom(false);
      }, 0);
    } catch (e: any) {
      showErr(e);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      try {
        await connRef.current?.stop();
      } catch {}
      setText('');
      setPickerOpen(false);
      setActionsOpen(false);
      setThread([]);
      setPeer(null);
      setChats([]);
      setUsers([]);
      setUnread({});
      seenIdsRef.current.clear();
      setAlias('');
      setUserId(0);
      await AsyncStorage.multiRemove(['alias', 'userId', 'lastPeerId']);
    } catch (e: any) {
      showErr(e);
    }
  }

  async function deleteMessage(id: number) {
    try {
      await fetch(`${API}/messages/${id}`, { method: 'DELETE' });
    } catch {
    } finally {
      setThread(prev => prev.filter(m => Number(m.id ?? m.Id) !== Number(id)));
      refreshChats();
    }
  }

  //send
  const canSend = useMemo(
    () => userId > 0 && !!peer?.id && text.trim().length > 0 && !busy,
    [userId, peer, text, busy],
  );

  async function sendMessage() {
    const t = text.trim();
    if (!t || !peer?.id) return;
    setBusy(true);
    try {
      await fetch(`${API}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, receiverId: peer.id, text: t }),
      }).then(r => readJson(r, 'POST /messages'));
      setText(''); // balon sadece SignalR ile düşecek
    } catch (e: any) {
      showErr(e);
    } finally {
      setBusy(false);
    }
  }

  //render
  if (userId <= 0) {
    return (
      <SafeAreaView style={s.wrap}>
        <Text style={s.brand}>
          <Text style={{ color: '#6366f1' }}>✦</Text> SentimentalChat
        </Text>
        <View style={s.loginCard}>
          <Text style={s.loginTitle}>Sentimental Chat’e Katılın</Text>
          <Text style={s.loginSub}>
            Sohbete başlamak için bir takma ad oluşturun.
          </Text>
          <Text style={s.label}>Takma Adınız</Text>
          <TextInput
            style={s.input}
            placeholder="Takma adınızı girin"
            value={alias}
            onChangeText={setAlias}
            onSubmitEditing={createAlias}
            autoCapitalize="none"
          />
          <Button
            title={busy ? 'Kaydediliyor...' : 'Sohbete Başla'}
            onPress={createAlias}
            disabled={busy || !alias.trim()}
          />
          {/* debug için istersen göster */}
          {!!API && (
            <Text style={{ marginTop: 10, color: '#6b7280', fontSize: 12 }}>
              API: {API}
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const unreadTotalExceptCurrent = Object.entries(unread).reduce(
    (acc, [pid, count]) =>
      peer && Number(pid) === Number(peer.id) ? acc : acc + (count || 0),
    0,
  );

  return (
    <SafeAreaView style={[s.wrap, { padding: 0 }]}>
      {/* HEADER */}
      <View style={s.header}>
        {peer ? (
          <>
            <TouchableOpacity
              style={s.backBtn}
              onPress={() => setPeer(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.backIcon}>‹</Text>
              {unreadTotalExceptCurrent > 0 && (
                <View style={s.backBadge}>
                  <Text style={s.backBadgeTxt}>{unreadTotalExceptCurrent}</Text>
                </View>
              )}
            </TouchableOpacity>
            <Avatar name={peer.alias} />
            <Text style={s.headerTitle}>{peer.alias}</Text>
            <Text style={s.headerMeta}>
              UserId: {userId} • Alias: {alias}
            </Text>
          </>
        ) : (
          <>
            <Text style={[s.headerTitle, { marginLeft: 12 }]}>Sohbetler</Text>
            <View style={{ flex: 1 }} />
            <Text style={s.headerMeta}>
              {alias} (#{userId})
            </Text>
            <TouchableOpacity
              style={s.plusBtn}
              onPress={() => setPickerOpen(true)}
            >
              <Text style={s.plusTxt}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                s.plusBtn,
                { marginLeft: 8, width: 'auto', paddingHorizontal: 10 },
              ]}
              onPress={() => {
                Alert.alert('Çıkış yap', 'Hesaptan çıkmak istiyor musunuz?', [
                  { text: 'Vazgeç', style: 'cancel' },
                  { text: 'Çıkış Yap', style: 'destructive', onPress: logout },
                ]);
              }}
            >
              <Text style={[s.plusTxt, { fontSize: 14 }]}>Çıkış</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* BODY */}
      {!peer ? (
        <View style={{ flex: 1 }}>
          {chats.length === 0 ? (
            <View style={{ padding: 16 }}>
              <Text style={{ color: '#9ca3af' }}>
                Henüz sohbet yok. “+” ile başlat.
              </Text>
            </View>
          ) : (
            <FlatList
              data={chats}
              keyExtractor={c => String(c.peer.id)}
              contentContainerStyle={{ padding: 12 }}
              renderItem={({ item }) => {
                const count = unread[item.peer.id] || 0;
                return (
                  <TouchableOpacity
                    onPress={() => setPeer(item.peer)}
                    style={s.chatRow}
                  >
                    <Avatar name={item.peer.alias} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.chatName}>{item.peer.alias}</Text>
                      <Text numberOfLines={1} style={s.chatPreview}>
                        {item.lastText || 'Mesaj yok'}
                      </Text>
                    </View>
                    {!!count && <Badge count={count} />}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {loading ? (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActivityIndicator size="large" />
              <Text style={{ marginTop: 8, color: '#6b7280' }}>
                Yükleniyor…
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              inverted
              data={[...thread].reverse()}
              keyExtractor={m => String(m.id ?? m.Id)}
              contentContainerStyle={{ padding: 12 }}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              renderItem={({ item: m }) => {
                const fromMe = Number(m.userId ?? m.UserId) === Number(userId);
                const label = String(
                  (m.sentimentLabel ?? m.SentimentLabel ?? 'NEUTRAL') as string,
                ).toUpperCase();
                const score = Number(m.sentimentScore ?? m.SentimentScore ?? 0);

                return (
                  <View
                    style={{
                      alignItems: fromMe ? 'flex-end' : 'flex-start',
                      marginBottom: 8,
                    }}
                  >
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onLongPress={() => {
                        if (!fromMe) return;
                        Alert.alert(
                          'Mesajı sil',
                          'Bu mesajı silmek istiyor musunuz?',
                          [
                            { text: 'Vazgeç', style: 'cancel' },
                            {
                              text: 'Sil',
                              style: 'destructive',
                              onPress: () =>
                                deleteMessage(Number(m.id ?? m.Id)),
                            },
                          ],
                        );
                      }}
                    >
                      <View
                        style={[s.bubble, fromMe ? s.bubbleMe : s.bubbleOther]}
                      >
                        <Text
                          style={[s.bubbleText, fromMe && { color: '#fff' }]}
                        >
                          {m.text ?? m.Text}
                        </Text>
                        <View style={s.bubbleMeta}>
                          <SmallBadge
                            text={label}
                            color={
                              label === 'POSITIVE'
                                ? '#16a34a'
                                : label === 'NEGATIVE'
                                ? '#dc2626'
                                : '#6b7280'
                            }
                            bg={
                              label === 'POSITIVE'
                                ? '#dcfce7'
                                : label === 'NEGATIVE'
                                ? '#fee2e2'
                                : '#f3f4f6'
                            }
                          />
                          <Text
                            style={[s.score, fromMe && { color: '#e0e7ff' }]}
                          >
                            skor: {score.toFixed(3)}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              }}
              onContentSizeChange={() => {
                if (thread.length) safeScrollToBottom(false);
              }}
              onLayout={() => {
                if (thread.length) safeScrollToBottom(false);
              }}
            />
          )}

          <View style={s.composer}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              placeholder={peer ? `${peer.alias}…` : 'Kişi seç…'}
              value={text}
              onChangeText={setText}
              onSubmitEditing={sendMessage}
            />
            <Button title="Gönder" onPress={sendMessage} disabled={!canSend} />
          </View>
        </KeyboardAvoidingView>
      )}

      {/* + Kullanıcı seçme Modal */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <TouchableOpacity
          style={s.modalBackdrop}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}
        >
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Yeni sohbet</Text>
            <FlatList
              data={users.filter(u => u.id !== userId)}
              keyExtractor={u => String(u.id)}
              renderItem={({ item: u }) => (
                <TouchableOpacity
                  style={s.userRow}
                  onPress={() => {
                    setPeer({ id: u.id, alias: u.alias });
                    setPickerOpen(false);
                  }}
                >
                  <Avatar name={u.alias} />
                  <View style={{ marginLeft: 10 }}>
                    <Text style={{ fontWeight: '600' }}>{u.alias}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 12 }}>
                      #{u.id}
                    </Text>
                  </View>
                  {!!unread[u.id] && <Badge count={unread[u.id]} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

//UI's
function Avatar({ name }: { name: string }) {
  const letter = (name?.[0] || '?').toUpperCase();
  return (
    <View style={s.avatar}>
      <Text style={s.avatarTxt}>{letter}</Text>
    </View>
  );
}
function Badge({ count }: { count: number }) {
  return (
    <View style={s.badge}>
      <Text style={s.badgeTxt}>{count}</Text>
    </View>
  );
}
function SmallBadge({
  text,
  color,
  bg,
}: {
  text: string;
  color: string;
  bg: string;
}) {
  return (
    <View style={[s.smallBadge, { backgroundColor: bg }]}>
      <Text style={[s.smallBadgeTxt, { color }]}>{text}</Text>
    </View>
  );
}

//css
const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: '#f5f7fb' },
  brand: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
  loginCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  loginTitle: { fontSize: 20, fontWeight: '800', marginBottom: 6 },
  loginSub: { color: '#6b7280', marginBottom: 12 },
  label: { fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
  },

  header: {
    height: 56,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerTitle: { fontWeight: '800', fontSize: 18, marginLeft: 8 },
  headerMeta: { marginLeft: 'auto', color: '#6b7280', fontSize: 12 },
  plusBtn: {
    marginLeft: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusTxt: { color: '#4338ca', fontWeight: '800', fontSize: 18 },

  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 20, fontWeight: '800', color: '#111827' },
  backBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: '#f43f5e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  backBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },

  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  chatName: { fontWeight: '600' },
  chatPreview: { fontSize: 12, color: '#6b7280', marginTop: 2, maxWidth: 200 },

  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { color: '#4338ca', fontWeight: '800' },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: '#f43f5e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  smallBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  smallBadgeTxt: { fontSize: 12, fontWeight: '800' },

  bubble: {
    maxWidth: 520,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  bubbleMe: { backgroundColor: '#4f46e5', borderColor: 'transparent' },
  bubbleOther: { backgroundColor: '#fff' },
  bubbleText: { color: '#111827' },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  score: { fontSize: 12, color: '#6b7280' },

  composer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    padding: 10,
    flexDirection: 'row',
    gap: 8,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    maxHeight: '70%',
  },
  modalTitle: { fontWeight: '800', fontSize: 16, marginBottom: 8 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
});
